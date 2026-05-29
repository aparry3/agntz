import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../src/stores/memory.js";
import { SpanEmitter } from "../../src/telemetry.js";
import type { TraceLiveEvent, WebhookEvent } from "../../src/types.js";
import { _resetCryptoKeyCache } from "../../src/utils/crypto.js";
import {
	WEBHOOK_DELIVERY_ID_HEADER,
	WEBHOOK_IDEMPOTENCY_HEADER,
	WEBHOOK_SIGNATURE_HEADER,
	createWebhookDispatcher,
	signBody,
} from "../../src/webhooks/dispatcher.js";

/**
 * MemoryStore now serves both HTTP-tool secrets and webhook HMAC keys via
 * the unified SecretStore — we just put a secret by name and pass that name
 * to the dispatcher.
 */
const SECRET_NAME = "gymtext_prod";
const SECRET_VALUE = "whsec_deadbeefdeadbeefdeadbeefdeadbeef";

async function setupStore(): Promise<MemoryStore> {
	const root = new MemoryStore({ strict: true });
	const store = root.forUser("user_a");
	await store.putSecret({ name: SECRET_NAME, value: SECRET_VALUE });
	return store;
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

beforeEach(() => {
	// MemoryStore's SecretStore implementation uses crypto.encryptSecret which
	// requires AGNTZ_SECRET_KEY. Set a deterministic key for tests.
	process.env.AGNTZ_SECRET_KEY =
		"0000000000000000000000000000000000000000000000000000000000000001";
	_resetCryptoKeyCache();
});

describe("createWebhookDispatcher", () => {
	it("200 response → delivered after 1 attempt", async () => {
		const store = await setupStore();
		const fetchMock = vi.fn(async () => makeResponse(200));

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const deliveries = await store.listPending();
		expect(deliveries.length).toBe(0);
	});

	it("500 → 500 → 200: three attempts, eventually delivered", async () => {
		const store = await setupStore();
		let call = 0;
		const fetchMock = vi.fn(async () => {
			call += 1;
			if (call <= 2) return makeResponse(500);
			return makeResponse(200);
		});

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0, 0, 0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("500 × 3 → failed_permanent, telemetry span errored", async () => {
		const store = await setupStore();
		const fetchMock = vi.fn(async () => makeResponse(500));

		const spanEvents: TraceLiveEvent[] = [];
		const emitter = new SpanEmitter({
			traceSink: (event) => spanEvents.push(event),
		});

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0, 0, 0],
			spanEmitter: emitter,
			ownerId: "user_a",
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(fetchMock).toHaveBeenCalledTimes(3);

		const pending = await store.listPending();
		expect(pending.length).toBe(0);

		const ends = spanEvents.filter((e) => e.type === "span-end");
		expect(ends.length).toBeGreaterThan(0);
		const errorEnd = ends.find(
			(e) => e.type === "span-end" && e.patch.status === "error",
		);
		expect(errorEnd).toBeDefined();
	});

	it("400 (not 429) → failed_permanent immediately, no retries", async () => {
		const store = await setupStore();
		const fetchMock = vi.fn(async () => makeResponse(400));

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0, 0, 0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("429 retried with backoff", async () => {
		const store = await setupStore();
		let call = 0;
		const fetchMock = vi.fn(async () => {
			call += 1;
			if (call === 1) return makeResponse(429);
			return makeResponse(200);
		});

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
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

	it("HMAC signature header matches signBody over the request body", async () => {
		const store = await setupStore();
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
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(capturedSignature).toBe(signBody(SECRET_VALUE, capturedBody));
		expect(capturedDeliveryId).toBeTruthy();
		expect(capturedIdempotencyKey).toBe(capturedDeliveryId);
	});

	it("regenerating between dispatches → next dispatch signs with the new value", async () => {
		const store = await setupStore();
		const captured: string[] = [];
		const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
			const headers = init.headers as Record<string, string>;
			captured.push(headers[WEBHOOK_SIGNATURE_HEADER]);
			return makeResponse(200);
		});

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		// Rotation in the new model: just upsert the same name with a new value.
		const NEW_VALUE = "whsec_newvaluenewvaluenewvaluenewvalue";
		await store.putSecret({ name: SECRET_NAME, value: NEW_VALUE });

		await dispatcher.dispatch(makeReplyEvent());

		expect(captured).toHaveLength(2);
		// First dispatch signed with the original value; second with the new one.
		const bodyEcho = JSON.stringify(makeReplyEvent());
		expect(captured[0]).toBe(signBody(SECRET_VALUE, bodyEcho));
		expect(captured[1]).toBe(signBody(NEW_VALUE, bodyEcho));
	});

	it("cancelled run delivers a final complete event with status=cancelled", async () => {
		const store = await setupStore();
		let lastPayload: Record<string, unknown> | null = null;
		const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
			lastPayload = JSON.parse(init.body as string) as Record<string, unknown>;
			return makeResponse(200);
		});

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: SECRET_NAME,
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0],
		});

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

	it("unknown secret name → failed_permanent without HTTP attempts", async () => {
		const store = await setupStore();
		const fetchMock = vi.fn(async () => makeResponse(200));

		const dispatcher = createWebhookDispatcher({
			deliveryStore: store,
			secretStore: store,
			secretName: "does_not_exist",
			callbackUrl: "https://consumer.example/webhook",
			runId: "run_1",
			fetch: fetchMock as unknown as typeof fetch,
			retryDelaysMs: [0],
		});

		await dispatcher.dispatch(makeReplyEvent());

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
