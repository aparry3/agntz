import { createHmac, randomBytes } from "node:crypto";
import type {
  InvokeResult,
  Reply,
  SecretStore,
  WebhookDeliveryStore,
} from "../types.js";
import type { SpanEmitter } from "../telemetry.js";
import {
  OutboundUrlPolicyError,
  fetchWithOutboundPolicy,
  type OutboundUrlPolicyOptions,
} from "../utils/outbound-url.js";

// ═══════════════════════════════════════════════════════════════════════
// Webhook dispatcher — signs and POSTs outbound webhook events for a run.
// Each `dispatch(event)` call inserts an outbox row, then attempts delivery
// with bounded retries. Failures are recorded but do not throw — webhook
// failures must never fail the originating run.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Header names emitted on every webhook POST. Centralized so tests and
 * consumer SDKs can reference the canonical strings.
 */
export const WEBHOOK_SIGNATURE_HEADER = "X-Agntz-Signature";
export const WEBHOOK_DELIVERY_ID_HEADER = "X-Agntz-Delivery-Id";
/** Mirrors the standard Webhooks header so consumers can dedupe replays. */
export const WEBHOOK_IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * Default retry schedule. The first entry is the initial attempt (no delay);
 * subsequent entries are inter-attempt waits. So `[0, 5000, 30000]` means:
 * try immediately, wait 5s on failure, then wait 30s on second failure, then
 * give up after the third attempt.
 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [0, 5000, 30000];

/** Default per-attempt timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface WebhookDispatcherOptions {
  deliveryStore: WebhookDeliveryStore;
  /**
   * Unified secrets store. The dispatcher resolves the HMAC signing key by
   * `secretName` at each delivery attempt and decrypts it inline, so an
   * out-of-band rotation flows through naturally without per-run pinning.
   */
  secretStore: SecretStore;
  /**
   * Name of the SecretStore entry whose plaintext is the HMAC signing key.
   * Caller validates existence before invoke (typically 400 on a missing
   * name from `POST /runs`).
   */
  secretName: string;
  /** Where to POST the payload. Pinned per dispatcher instance. */
  callbackUrl: string;
  /** Run id for outbox correlation. */
  runId: string;
  /** Fetch override (tests). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Override outbound URL policy. Custom test fetches skip DNS by default. */
  outboundUrlPolicy?: OutboundUrlPolicyOptions;
  /** Per-attempt timeout (ms). Default 10_000. */
  timeoutMs?: number;
  /**
   * Inter-attempt delays in ms. First entry is delay before the first attempt
   * (use 0 for "try immediately"). Length determines max attempts.
   * Default `[0, 5000, 30000]` → 3 attempts.
   */
  retryDelaysMs?: readonly number[];
  /**
   * Optional SpanEmitter used to record a `webhook_delivery` span per dispatch.
   * The span ends with `status="error"` on permanent failure.
   */
  spanEmitter?: SpanEmitter;
  /** Tenant scoping for the emitted span. Required when `spanEmitter` is set. */
  ownerId?: string;
  /** Optional `setTimeout` override (tests). */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
}

/**
 * One outbound webhook event. The shape stays close to the on-the-wire payload
 * a consumer receives — the dispatcher serializes the event verbatim (minus
 * the `type` discriminator routing) so receivers see the same JSON the
 * dispatcher signs.
 */
export type WebhookEvent =
  | {
      type: "reply";
      runId: string;
      sessionId: string;
      text: string;
      ts: string;
    }
  | {
      type: "complete";
      runId: string;
      sessionId: string;
      status: "completed" | "failed" | "cancelled";
      output: unknown;
      replies?: Reply[];
      result?: InvokeResult;
      error?: string;
    };

export interface WebhookDispatcher {
  /**
   * Queue an event for delivery. Returns a promise that resolves when the
   * delivery loop has finished (either delivered or marked failed_permanent).
   * Callers may choose not to await this — the run continues regardless.
   */
  dispatch(event: WebhookEvent): Promise<void>;
  /** Returns a promise that resolves when all in-flight dispatches settle. */
  drain(): Promise<void>;
}

export function createWebhookDispatcher(
  opts: WebhookDispatcherOptions,
): WebhookDispatcher {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      "createWebhookDispatcher: no fetch available. Pass `opts.fetch` or run on a runtime with global fetch.",
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outboundUrlPolicy = opts.outboundUrlPolicy ?? (
    opts.fetch ? { skipDnsResolution: true } : undefined
  );
  const retryDelaysMs =
    opts.retryDelaysMs && opts.retryDelaysMs.length > 0
      ? opts.retryDelaysMs
      : DEFAULT_RETRY_DELAYS_MS;
  const inFlight = new Set<Promise<void>>();
  const sleep = opts.setTimeoutImpl
    ? (ms: number) =>
        new Promise<void>((r) => {
          opts.setTimeoutImpl!(() => r(), ms);
        })
    : (ms: number) =>
        new Promise<void>((r) => setTimeout(r, ms));

  async function dispatch(event: WebhookEvent): Promise<void> {
    const deliveryId = `whd_${randomBytes(12).toString("hex")}`;
    const payload = eventToPayload(event);

    await opts.deliveryStore.insert({
      id: deliveryId,
      runId: opts.runId,
      callbackUrl: opts.callbackUrl,
      secretName: opts.secretName,
      payload,
    });

    const span = opts.spanEmitter && opts.ownerId
      ? opts.spanEmitter.startInvoke({
          agentId: "webhook",
          invocationId: deliveryId,
          model: "webhook",
          ownerId: opts.ownerId,
          runId: opts.runId,
        })
      : null;

    const job = (async () => {
      try {
        await runDeliveryLoop({
          deliveryId,
          payload,
          callbackUrl: opts.callbackUrl,
          secretName: opts.secretName,
          secretStore: opts.secretStore,
          deliveryStore: opts.deliveryStore,
          fetchImpl,
          outboundUrlPolicy,
          timeoutMs,
          retryDelaysMs,
          sleep,
          span,
        });
      } finally {
        // Job always settles — failures are caught and recorded in the store.
        // Span ending happens in runDeliveryLoop's status branches.
      }
    })();

    inFlight.add(job);
    job.finally(() => inFlight.delete(job));
    return job;
  }

  async function drain(): Promise<void> {
    if (inFlight.size === 0) return;
    await Promise.allSettled(Array.from(inFlight));
  }

  return { dispatch, drain };
}

/**
 * Verbatim JSON sent to the consumer. The wire payload IS the signed body.
 */
function eventToPayload(event: WebhookEvent): Record<string, unknown> {
  return { ...event } as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────
// Delivery loop
// ───────────────────────────────────────────────────────────────────────

interface DeliveryLoopOpts {
  deliveryId: string;
  payload: Record<string, unknown>;
  callbackUrl: string;
  secretName: string;
  secretStore: SecretStore;
  deliveryStore: WebhookDeliveryStore;
  fetchImpl: typeof fetch;
  outboundUrlPolicy?: OutboundUrlPolicyOptions;
  timeoutMs: number;
  retryDelaysMs: readonly number[];
  sleep: (ms: number) => Promise<void>;
  span: ReturnType<SpanEmitter["startInvoke"]> | null;
}

async function runDeliveryLoop(o: DeliveryLoopOpts): Promise<void> {
  // Resolve secret once before the loop. We sign with the value as it is now;
  // any out-of-band rotation will be picked up on the next attempt of a
  // future delivery. (We deliberately don't re-resolve between retries of
  // this delivery — the consumer who got our first signature should be able
  // to verify the second too.)
  const plaintext = await o.secretStore.getSecretValue(o.secretName);
  if (plaintext == null) {
    const err = `webhook secret not found: ${o.secretName}`;
    await o.deliveryStore.updateStatus(o.deliveryId, "failed_permanent", err);
    o.span?.error(err);
    return;
  }

  const body = JSON.stringify(o.payload);
  const signature = signBody(plaintext, body);

  let lastError = "";
  for (let attempt = 0; attempt < o.retryDelaysMs.length; attempt++) {
    const delay = o.retryDelaysMs[attempt];
    if (delay > 0) await o.sleep(delay);

    const result = await attemptDelivery({
      deliveryId: o.deliveryId,
      url: o.callbackUrl,
      body,
      signature,
      fetchImpl: o.fetchImpl,
      outboundUrlPolicy: o.outboundUrlPolicy,
      timeoutMs: o.timeoutMs,
    });

    await o.deliveryStore.incrementAttempt(o.deliveryId, result.errorMessage);
    lastError = result.errorMessage ?? "";

    if (result.outcome === "success") {
      await o.deliveryStore.updateStatus(o.deliveryId, "delivered");
      o.span?.end();
      return;
    }
    if (result.outcome === "permanent") {
      await o.deliveryStore.updateStatus(
        o.deliveryId,
        "failed_permanent",
        result.errorMessage,
      );
      o.span?.error(`${o.callbackUrl} [attempt ${attempt + 1}]: ${result.errorMessage ?? "permanent failure"}`);
      return;
    }
    // outcome === "retry" → continue loop
  }

  await o.deliveryStore.updateStatus(o.deliveryId, "failed_permanent", lastError);
  o.span?.error(`${o.callbackUrl} [retries exhausted]: ${lastError || "no further detail"}`);
}

interface AttemptOpts {
  deliveryId: string;
  url: string;
  body: string;
  signature: string;
  fetchImpl: typeof fetch;
  outboundUrlPolicy?: OutboundUrlPolicyOptions;
  timeoutMs: number;
}

interface AttemptResult {
  outcome: "success" | "retry" | "permanent";
  errorMessage?: string;
}

async function attemptDelivery(o: AttemptOpts): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs);
  try {
    const res = await fetchWithOutboundPolicy(
      o.url,
      {
        method: "POST",
        body: o.body,
        headers: {
          "Content-Type": "application/json",
          [WEBHOOK_SIGNATURE_HEADER]: o.signature,
          [WEBHOOK_DELIVERY_ID_HEADER]: o.deliveryId,
          [WEBHOOK_IDEMPOTENCY_HEADER]: o.deliveryId,
        },
        signal: controller.signal,
      },
      {
        fetchImpl: o.fetchImpl,
        policy: o.outboundUrlPolicy,
      },
    );
    if (res.status >= 200 && res.status < 300) {
      return { outcome: "success" };
    }
    // 429 → retry as 5xx. Other 4xx → permanent (consumer rejected).
    if (res.status === 429 || res.status >= 500) {
      return {
        outcome: "retry",
        errorMessage: `HTTP ${res.status}`,
      };
    }
    return {
      outcome: "permanent",
      errorMessage: `HTTP ${res.status}`,
    };
  } catch (err) {
    if (err instanceof OutboundUrlPolicyError) {
      return {
        outcome: "permanent",
        errorMessage: err.message,
      };
    }
    // Abort, network error, or DNS failure → retry-eligible.
    const message = err instanceof Error ? err.message : String(err);
    return {
      outcome: "retry",
      errorMessage: message || "fetch error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HMAC-SHA256 over the request body, prefixed with `sha256=`. Mirrors the
 * Stripe-style signature header consumers can verify with the raw secret they
 * captured at create/rotate time.
 */
export function signBody(rawSecret: string, body: string): string {
  const hmac = createHmac("sha256", rawSecret);
  hmac.update(body, "utf8");
  return `sha256=${hmac.digest("hex")}`;
}
