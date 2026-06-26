import { createHmac, randomBytes } from "node:crypto";
import type { InvokeResult, Reply, SecretStore } from "@agntz/contracts";
import {
	OutboundUrlPolicyError,
	type OutboundUrlPolicyOptions,
	fetchWithOutboundPolicy,
} from "@agntz/contracts";
import type { WebhookDeliveryStore } from "@agntz/stores/contracts";

export const WEBHOOK_SIGNATURE_HEADER = "X-Agntz-Signature";
export const WEBHOOK_DELIVERY_ID_HEADER = "X-Agntz-Delivery-Id";
export const WEBHOOK_IDEMPOTENCY_HEADER = "Idempotency-Key";

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [0, 5000, 30000];
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface WebhookInvokeSpan {
	end(): void;
	error(err: Error | string): void;
}

export interface WebhookSpanEmitter {
	startInvoke(params: {
		agentId: string;
		invocationId: string;
		model: string;
		ownerId?: string;
		runId?: string | null;
	}): WebhookInvokeSpan;
}

export interface WebhookDispatcherOptions {
	deliveryStore: WebhookDeliveryStore;
	secretStore: SecretStore;
	secretName: string;
	callbackUrl: string;
	runId: string;
	fetch?: typeof fetch;
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
	timeoutMs?: number;
	retryDelaysMs?: readonly number[];
	spanEmitter?: WebhookSpanEmitter;
	ownerId?: string;
	setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
}

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
	dispatch(event: WebhookEvent): Promise<void>;
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
	const outboundUrlPolicy =
		opts.outboundUrlPolicy ??
		(opts.fetch ? { skipDnsResolution: true } : undefined);
	const retryDelaysMs =
		opts.retryDelaysMs && opts.retryDelaysMs.length > 0
			? opts.retryDelaysMs
			: DEFAULT_RETRY_DELAYS_MS;
	const inFlight = new Set<Promise<void>>();
	const sleep = opts.setTimeoutImpl
		? (ms: number) =>
				new Promise<void>((r) => {
					opts.setTimeoutImpl?.(() => r(), ms);
				})
		: (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

		const span =
			opts.spanEmitter && opts.ownerId
				? opts.spanEmitter.startInvoke({
						agentId: "webhook",
						invocationId: deliveryId,
						model: "webhook",
						ownerId: opts.ownerId,
						runId: opts.runId,
					})
				: null;

		const job = runDeliveryLoop({
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

function eventToPayload(event: WebhookEvent): Record<string, unknown> {
	return { ...event } as Record<string, unknown>;
}

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
	span: WebhookInvokeSpan | null;
}

async function runDeliveryLoop(o: DeliveryLoopOpts): Promise<void> {
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
			o.span?.error(
				`${o.callbackUrl} [attempt ${attempt + 1}]: ${result.errorMessage ?? "permanent failure"}`,
			);
			return;
		}
	}

	await o.deliveryStore.updateStatus(
		o.deliveryId,
		"failed_permanent",
		lastError,
	);
	o.span?.error(
		`${o.callbackUrl} [retries exhausted]: ${lastError || "no further detail"}`,
	);
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
		if (res.status >= 200 && res.status < 300) return { outcome: "success" };
		if (res.status === 429 || res.status >= 500) {
			return { outcome: "retry", errorMessage: `HTTP ${res.status}` };
		}
		return { outcome: "permanent", errorMessage: `HTTP ${res.status}` };
	} catch (err) {
		if (err instanceof OutboundUrlPolicyError) {
			return { outcome: "permanent", errorMessage: err.message };
		}
		const message = err instanceof Error ? err.message : String(err);
		return { outcome: "retry", errorMessage: message || "fetch error" };
	} finally {
		clearTimeout(timer);
	}
}

export function signBody(rawSecret: string, body: string): string {
	const hmac = createHmac("sha256", rawSecret);
	hmac.update(body, "utf8");
	return `sha256=${hmac.digest("hex")}`;
}
