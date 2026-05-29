import { StreamError } from "./errors.js";
import type {
	AgentKind,
	MultiplexedRunEvent,
	Run,
	Span,
	SseFrame,
	StreamEvent,
	TraceLiveEvent,
	TraceSummary,
} from "./types.js";

/**
 * Map an SSE wire frame to a public StreamEvent. Unknown events return null
 * so the wire format can evolve without breaking consumers. Invalid JSON in
 * the data payload throws StreamError — that's a real protocol violation.
 */
export function normalizeEvent(frame: SseFrame): StreamEvent | null {
	if (!frame.event) return null;
	const payload = parseData(frame.data, frame.event);
	switch (frame.event) {
		case "run-start": {
			const agentId = asString(payload, "agentId");
			const kind = asAgentKind(payload);
			const sessionId = asString(payload, "sessionId");
			return { type: "start", agentId, kind, sessionId };
		}
		case "run-complete": {
			const output = (payload as { output?: unknown }).output;
			const state = asStateRecord(payload);
			const sessionId = asString(payload, "sessionId");
			return { type: "complete", output, state, sessionId };
		}
		case "run-error": {
			const error = asString(payload, "error");
			return { type: "error", error };
		}
		case "reply": {
			const text = asString(payload, "text");
			const ts = asString(payload, "ts");
			const sessionId = asString(payload, "sessionId");
			const runId = asString(payload, "runId");
			const seqVal = (payload as { seq?: unknown }).seq;
			const seq = typeof seqVal === "number" ? seqVal : undefined;
			return seq === undefined
				? { type: "reply", text, ts, sessionId, runId }
				: { type: "reply", text, ts, sessionId, runId, seq };
		}
		default:
			return null;
	}
}

function parseData(data: string, event: string): unknown {
	try {
		return JSON.parse(data);
	} catch (cause) {
		throw new StreamError(`Invalid JSON in "${event}" event data`, {
			code: "INVALID_SSE_PAYLOAD",
			cause,
		});
	}
}

function asString(payload: unknown, field: string): string {
	const obj = payload as Record<string, unknown> | null;
	const value = obj?.[field];
	if (typeof value !== "string") {
		throw new StreamError(`SSE payload missing string field "${field}"`, {
			code: "INVALID_SSE_PAYLOAD",
		});
	}
	return value;
}

function asAgentKind(payload: unknown): AgentKind {
	const kind = (payload as { kind?: unknown }).kind;
	if (
		kind === "llm" ||
		kind === "tool" ||
		kind === "sequential" ||
		kind === "parallel"
	) {
		return kind;
	}
	throw new StreamError(`Unknown agent kind: ${String(kind)}`, {
		code: "INVALID_SSE_PAYLOAD",
	});
}

function asStateRecord(payload: unknown): Record<string, unknown> {
	const state = (payload as { state?: unknown }).state;
	if (state && typeof state === "object" && !Array.isArray(state)) {
		return state as Record<string, unknown>;
	}
	return {};
}

/**
 * Map an SSE wire frame from /runs/:id/stream to a typed MultiplexedRunEvent.
 * Returns null for unknown event types so the wire format can evolve. Throws
 * StreamError on invalid JSON or shape violations.
 */
export function normalizeRunEvent(frame: SseFrame): MultiplexedRunEvent | null {
	if (!frame.event) return null;
	const payload = parseData(frame.data, frame.event);
	switch (frame.event) {
		case "run-spawn":
		case "text-delta":
		case "tool-call-start":
		case "tool-call-end":
		case "step-complete":
		case "draining":
		case "reply":
		case "run-complete":
		case "run-error":
		case "run-cancelled":
			return payload as MultiplexedRunEvent;
		case "snapshot": {
			return { type: "snapshot", run: payload as Run };
		}
		case "stream-error": {
			const error = asString(payload, "error");
			throw new StreamError(error, { code: "STREAM_ERROR" });
		}
		default:
			return null;
	}
}

/**
 * Map an SSE wire frame from /traces/:id/stream to a typed TraceLiveEvent.
 * The `snapshot` event is SDK-only — the registry never emits it; the worker
 * synthesises it for terminal traces in the stream endpoint.
 */
export function normalizeTraceLiveEvent(
	frame: SseFrame,
): TraceLiveEvent | null {
	if (!frame.event) return null;
	const payload = parseData(frame.data, frame.event);
	switch (frame.event) {
		case "span-start": {
			const span = (payload as { span?: unknown }).span as Span;
			return { type: "span-start", span };
		}
		case "span-end": {
			const obj = payload as { spanId?: unknown; patch?: unknown };
			const spanId = asString(obj, "spanId");
			const patch = (obj.patch as Partial<Span>) ?? {};
			return { type: "span-end", spanId, patch };
		}
		case "trace-done": {
			const summary = (payload as { summary?: unknown })
				.summary as TraceSummary;
			return { type: "trace-done", summary };
		}
		case "snapshot": {
			const obj = payload as { summary?: unknown; spans?: unknown };
			const summary = obj.summary as TraceSummary;
			const spans = (obj.spans as Span[]) ?? [];
			return { type: "snapshot", summary, spans };
		}
		case "stream-error": {
			const error = asString(payload, "error");
			throw new StreamError(error, { code: "STREAM_ERROR" });
		}
		default:
			return null;
	}
}
