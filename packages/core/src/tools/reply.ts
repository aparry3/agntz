import { z } from "zod";
import type {
	Reply,
	RunRegistry,
	SessionStore,
	ToolDefinition,
} from "../types.js";

/**
 * Per-invocation dependencies for the synthetic `reply` tool. Built by the
 * runner at the top of each `invoke()`/`stream()` call and threaded into the
 * tool factory; never stored globally.
 */
export interface ReplyToolDeps {
	/**
	 * Mutable per-invocation buffer. Each successful reply is pushed onto
	 * `collector`; the runner surfaces it on `InvokeResult.replies` at the end
	 * of the run.
	 */
	collector: Reply[];
	/** Effective sessionId (auto-allocated if the caller didn't pass one). */
	sessionId: string;
	/**
	 * Run id for this invocation. The runner allocates one when a `RunRegistry`
	 * is wired; for runner-only invokes it's the invocationId.
	 */
	runId: string;
	/**
	 * Root run id for this invocation. Used as the channel id when emitting
	 * the `reply` multiplexed event so subscribers of the subtree see it.
	 * Falls back to `runId` for top-level runs.
	 */
	rootId?: string;
	/**
	 * Session store used to persist each reply as an assistant message at the
	 * moment of the call. Durable history reflects partial output even when
	 * the run is later cancelled.
	 */
	sessionStore: SessionStore;
	/**
	 * Optional registry. When provided, each accepted reply is broadcast as a
	 * multiplexed `reply` event (Phase 4 will surface these to SSE).
	 */
	runRegistry?: RunRegistry;
	/**
	 * Rate limit. The (`maxPerRun`+1)th call returns `{ delivered: false,
	 * reason: "rate_limited" }` to the model instead of throwing — the agent
	 * should still be able to recover and emit a final response.
	 */
	maxPerRun: number;
	/**
	 * Sliding window in milliseconds for duplicate suppression. If the most
	 * recent reply has identical text and was sent within `dedupeWindowMs` of
	 * the new call, the new call is rejected with `reason: "duplicate"`.
	 * Default 100ms — guards against accidental double-emit in retry/refresh
	 * loops without blocking legitimate repetition.
	 */
	dedupeWindowMs?: number;
	/**
	 * Optional callback fired after a reply is accepted (persisted, collected,
	 * and broadcast to the registry). `Runner.stream` uses this as a side
	 * channel to forward reply events to its async generator output in real
	 * time — the registry path is for out-of-process subscribers, this is for
	 * the in-process stream consumer. Rejections (rate-limited / duplicate)
	 * are NOT delivered to this callback.
	 */
	onAccepted?: (reply: Reply) => void;
}

/**
 * Build the synthetic `reply` tool. One per invocation — the tool closes over
 * the invocation's `collector`, `sessionId`, and `runId`, so it MUST NOT be
 * registered in the global `ToolRegistry` (which is process-wide and would
 * leak state across runs).
 */
export function createReplyTool(deps: ReplyToolDeps): ToolDefinition {
	const dedupeWindowMs = deps.dedupeWindowMs ?? 100;

	return {
		name: "reply",
		description:
			"Send an intermediate message to the user during this run. Each call appears to the user immediately. Use sparingly — only when you need to convey progress, an in-progress finding, or a separate logical message. Your final summarizing reply should still be returned as the assistant's normal response.",
		input: z.object({
			text: z
				.string()
				.min(1)
				.describe("The message text to deliver to the user."),
		}),
		async execute(input) {
			const { text } = input as { text: string };

			// Rate limit. Soft-fail to the model so the agent can recover and
			// still produce its final response — throwing would surface as a
			// tool error and bias the agent toward retry loops.
			if (deps.collector.length >= deps.maxPerRun) {
				return {
					delivered: false,
					reason: "rate_limited" as const,
					maxPerRun: deps.maxPerRun,
				};
			}

			// Dedupe: identical text within the sliding window. Compared against
			// the most recent reply only — a longer window would forbid valid
			// repetition (e.g. status pings on a long-running task).
			const now = Date.now();
			const last = deps.collector[deps.collector.length - 1];
			if (last && last.text === text) {
				const lastTime = Date.parse(last.ts);
				if (Number.isFinite(lastTime) && now - lastTime < dedupeWindowMs) {
					return {
						delivered: false,
						reason: "duplicate" as const,
					};
				}
			}

			const ts = new Date(now).toISOString();
			const reply: Reply = {
				text,
				ts,
				sessionId: deps.sessionId,
				runId: deps.runId,
			};

			// Persist immediately so conversation history reflects the reply even
			// if the invocation is cancelled before its final assistant message
			// gets written. The runner's end-of-run persistence path knows to
			// skip the empty assistant row in that case (see runner.ts).
			await deps.sessionStore.append(deps.sessionId, [
				{ role: "assistant", content: text, timestamp: ts },
			]);

			deps.collector.push(reply);

			// Broadcast to anyone subscribed to the run subtree. The registry
			// stamps a `seq`, so the placeholder value here is fine. Use rootId
			// as the channel id when available so spawned children's replies
			// surface on the same subscription as the parent.
			if (deps.runRegistry) {
				const channel = deps.rootId ?? deps.runId;
				deps.runRegistry.emit(channel, {
					type: "reply",
					runId: deps.runId,
					sessionId: deps.sessionId,
					text,
					ts,
					seq: 0,
				});
			}

			// In-process side channel for the stream consumer (Runner.stream).
			// Fired after persistence + collector + registry emit so a stream
			// subscriber sees the same totally-ordered view as the registry.
			deps.onAccepted?.(reply);

			return { delivered: true as const };
		},
	};
}
