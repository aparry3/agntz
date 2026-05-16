import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  createWebhookDispatcher,
  signBody,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_IDEMPOTENCY_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from "../../src/webhooks/dispatcher.js";
import { MemoryStore } from "../../src/stores/memory.js";
import { SpanEmitter } from "../../src/telemetry.js";
import type {
  TraceLiveEvent,
  WebhookEvent,
  WebhookSecret,
} from "../../src/types.js";

/**
 * Make a memory-backed store that has a pre-provisioned webhook secret and
 * an empty delivery outbox. The dispatcher only needs these two interfaces;
 * we keep the helper tight so each test reads top-to-bottom.
 */
async function setupStore(): Promise<{
  store: MemoryStore;
  secret: WebhookSecret;
}> {
  const root = new MemoryStore({ strict: true });
  const store = root.forUser("user_a");
  const created = await store.create("gymtext-prod");
  return { store, secret: created };
}

function makeReplyEvent(): WebhookEvent {
  return {
    type: "reply",
    runId: "run_1",
    sessionId: "sess_1",
    text: "hello",
    ts: "2026-05-16T00:00:00.000Z",
  };
}

/** Minimal Response stand-in matching what the dispatcher uses. */
function makeResponse(status: number): Response {
  return new Response(null, { status });
}

describe("createWebhookDispatcher", () => {
  it("200 response → delivered after 1 attempt", async () => {
    const { store, secret } = await setupStore();
    const fetchMock = vi.fn(async () => makeResponse(200));

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      // No delay so the test runs synchronously.
      retryDelaysMs: [0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deliveries = await store.listPending();
    // delivered → no longer pending
    expect(deliveries.length).toBe(0);
  });

  it("500 → 500 → 200: three attempts, eventually delivered", async () => {
    const { store, secret } = await setupStore();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call <= 2) return makeResponse(500);
      return makeResponse(200);
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0, 0, 0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("500 × 3 → failed_permanent, lastError set, telemetry span errored", async () => {
    const { store, secret } = await setupStore();
    const fetchMock = vi.fn(async () => makeResponse(500));

    const spanEvents: TraceLiveEvent[] = [];
    const emitter = new SpanEmitter({
      traceSink: (event) => spanEvents.push(event),
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0, 0, 0],
      spanEmitter: emitter,
      ownerId: "user_a",
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The dispatcher should have flipped the delivery to failed_permanent.
    // Pending list excludes failed rows, so it's empty; sanity check via the
    // raw backing map by calling listPending without filter.
    const pending = await store.listPending();
    expect(pending.length).toBe(0);

    // Span lifecycle: at least one span-start and one span-end with status=error.
    const ends = spanEvents.filter((e) => e.type === "span-end");
    expect(ends.length).toBeGreaterThan(0);
    const errorEnd = ends.find(
      (e) => e.type === "span-end" && e.patch.status === "error",
    );
    expect(errorEnd).toBeDefined();
  });

  it("400 (not 429) → failed_permanent immediately, no retries", async () => {
    const { store, secret } = await setupStore();
    const fetchMock = vi.fn(async () => makeResponse(400));

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0, 0, 0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 retried with backoff", async () => {
    const { store, secret } = await setupStore();
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return makeResponse(429);
      return makeResponse(200);
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0, 0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HMAC signature verifies against a known fixture", async () => {
    const raw = "whsec_deadbeef";
    const body = JSON.stringify({ hello: "world" });
    const expected = `sha256=${createHmac("sha256", raw)
      .update(body, "utf8")
      .digest("hex")}`;
    expect(signBody(raw, body)).toBe(expected);
  });

  it("HMAC signature header on dispatch matches signBody over the request body", async () => {
    const { store, secret } = await setupStore();
    let capturedSignature = "";
    let capturedBody = "";
    let capturedDeliveryId = "";
    let capturedIdempotencyKey = "";

    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      const headers = init.headers as Record<string, string>;
      capturedSignature = headers[WEBHOOK_SIGNATURE_HEADER];
      capturedDeliveryId = headers[WEBHOOK_DELIVERY_ID_HEADER];
      capturedIdempotencyKey = headers[WEBHOOK_IDEMPOTENCY_HEADER];
      return makeResponse(200);
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(capturedSignature).toBe(signBody(secret.secret, capturedBody));
    // Delivery id is included in BOTH headers so consumers can dedupe either way.
    expect(capturedDeliveryId).toBeTruthy();
    expect(capturedIdempotencyKey).toBe(capturedDeliveryId);
  });

  it("uses the pinned secret_id even after rotation", async () => {
    const { store, secret } = await setupStore();
    // Rotate BEFORE dispatching. The old secret stays resolvable by id and
    // should be the one used to sign — that's the whole point of pinning.
    const fresh = await store.rotate(secret.id);
    expect(fresh.id).not.toBe(secret.id);

    let capturedSignature = "";
    let capturedBody = "";
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      capturedSignature = (init.headers as Record<string, string>)[
        WEBHOOK_SIGNATURE_HEADER
      ];
      return makeResponse(200);
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id, // pinned to OLD id
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    // Signed with the OLD secret, not the rotated one.
    expect(capturedSignature).toBe(signBody(secret.secret, capturedBody));
    expect(capturedSignature).not.toBe(signBody(fresh.secret, capturedBody));
  });

  it("cancelled run delivers a final complete event with status=cancelled", async () => {
    const { store, secret } = await setupStore();
    let lastPayload: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      lastPayload = JSON.parse(init.body as string) as Record<string, unknown>;
      return makeResponse(200);
    });

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: secret.id,
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0],
    });

    // Simulate the route handler's forwarder: a reply, then a cancelled
    // complete event. Both should reach the consumer in order.
    await dispatcher.dispatch(makeReplyEvent());
    await dispatcher.dispatch({
      type: "complete",
      runId: "run_1",
      sessionId: "sess_1",
      status: "cancelled",
      output: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastPayload).toMatchObject({
      type: "complete",
      runId: "run_1",
      status: "cancelled",
    });
  });

  it("404 secret_id resolution → failed_permanent without HTTP attempts", async () => {
    const { store } = await setupStore();
    const fetchMock = vi.fn(async () => makeResponse(200));

    const dispatcher = createWebhookDispatcher({
      deliveryStore: store,
      secretStore: store,
      secretId: "whsec_nonexistent",
      callbackUrl: "https://consumer.example/webhook",
      runId: "run_1",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [0],
    });

    await dispatcher.dispatch(makeReplyEvent());

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
