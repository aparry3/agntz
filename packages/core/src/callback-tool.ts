import { createHmac, randomBytes } from "node:crypto";
import {
	type CallbackToolEntry,
	type OutboundUrlPolicyOptions,
	type SecretStore,
	fetchWithOutboundPolicy,
} from "@agntz/contracts";
import { z } from "zod";
import { compileManifestSchema } from "./manifest/schema.js";
import type { ToolDefinition } from "./types.js";

export const CALLBACK_SIGNATURE_HEADER = "X-Agntz-Signature";
export const CALLBACK_TIMESTAMP_HEADER = "X-Agntz-Timestamp";
export const CALLBACK_DELIVERY_ID_HEADER = "X-Agntz-Delivery-Id";
export const CALLBACK_IDEMPOTENCY_HEADER = "Idempotency-Key";

export interface CallbackToolDeps {
	secretStore: SecretStore;
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
	fetch?: typeof fetch;
}

export function buildCallbackToolDefinition(
	entry: CallbackToolEntry,
	deps: CallbackToolDeps,
): ToolDefinition {
	const validate = compileManifestSchema(entry.inputSchema);
	const input = z.unknown().superRefine((value, ctx) => {
		if (validate(value)) return;
		for (const issue of validate.errors ?? []) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: issue.instancePath.split("/").slice(1).filter(Boolean),
				message: issue.message ?? "invalid callback argument",
			});
		}
	});

	return {
		name: `callback__${entry.name}`,
		description: entry.description ?? "",
		input,
		modelInputSchema: entry.inputSchema,
		async execute(args, ctx): Promise<unknown> {
			const secret = await deps.secretStore.getSecretValue(entry.secret);
			if (!secret) {
				return {
					error: `Callback signing secret '${entry.secret}' is not configured`,
				};
			}
			const deliveryId = `cbd_${randomBytes(18).toString("base64url")}`;
			const timestamp = new Date().toISOString();
			const body = JSON.stringify({
				tool: entry.name,
				args,
				runtime: {
					sessionId: ctx.sessionId,
					runId: ctx.runId,
					agentId: ctx.agentId,
				},
				delivery: {
					id: deliveryId,
					timestamp,
				},
			});
			const signature = signCallback(secret, timestamp, deliveryId, body);
			const headers = {
				"Content-Type": "application/json",
				[CALLBACK_SIGNATURE_HEADER]: signature,
				[CALLBACK_TIMESTAMP_HEADER]: timestamp,
				[CALLBACK_DELIVERY_ID_HEADER]: deliveryId,
				[CALLBACK_IDEMPOTENCY_HEADER]: deliveryId,
			};
			const maxRetries = Math.min(Math.max(entry.maxRetries ?? 2, 0), 5);
			const timeoutMs = Math.min(
				Math.max(entry.timeoutMs ?? 30_000, 1000),
				120_000,
			);
			let lastError = "";
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				if (attempt > 0) {
					await abortableDelay(100 * 2 ** (attempt - 1), ctx.signal);
				}
				try {
					const signals = [ctx.signal, AbortSignal.timeout(timeoutMs)].filter(
						(value): value is AbortSignal => Boolean(value),
					);
					const response = await fetchWithOutboundPolicy(
						entry.url,
						{
							method: "POST",
							headers,
							body,
							signal:
								signals.length === 1 ? signals[0] : AbortSignal.any(signals),
						},
						{
							fetchImpl: deps.fetch,
							policy:
								deps.outboundUrlPolicy ??
								(deps.fetch ? { skipDnsResolution: true } : undefined),
						},
					);
					const text = (await response.text()).slice(0, 40_000);
					if (response.ok) {
						try {
							return JSON.parse(text);
						} catch {
							return text;
						}
					}
					lastError = `HTTP ${response.status}: ${text}`;
					if (
						response.status < 500 &&
						response.status !== 408 &&
						response.status !== 429
					) {
						break;
					}
				} catch (error) {
					if (ctx.signal?.aborted) throw error;
					lastError = error instanceof Error ? error.message : String(error);
				}
			}
			return {
				error: `Callback delivery failed: ${lastError}`,
				deliveryId,
			};
		},
	};
}

export function signCallback(
	secret: string,
	timestamp: string,
	deliveryId: string,
	body: string,
): string {
	return `sha256=${createHmac("sha256", secret)
		.update(`${timestamp}.${deliveryId}.${body}`)
		.digest("hex")}`;
}

async function abortableDelay(
	ms: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (signal?.aborted) throw signal.reason;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
