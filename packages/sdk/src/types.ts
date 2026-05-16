export interface AgntzClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  defaultSignal?: AbortSignal;
}

export interface RunInput {
  agentId: string;
  input?: unknown;
  /** Forward-compat: worker accepts but ignores today. */
  sessionId?: string;
  signal?: AbortSignal;
}

export interface RunResult {
  output: unknown;
  state: Record<string, unknown>;
  /**
   * Session this run executed under. Always present — the worker auto-allocates
   * one if the caller didn't pass `sessionId` on the request. Persist this id
   * client-side to continue the conversation on subsequent /run calls.
   */
  sessionId: string;
}

export type AgentKind = "llm" | "tool" | "sequential" | "parallel";

export type StreamEvent =
  | { type: "start"; agentId: string; kind: AgentKind; sessionId: string }
  | { type: "complete"; output: unknown; state: Record<string, unknown>; sessionId: string }
  | { type: "error"; error: string };

export interface HealthResult {
  status: string;
  service: string;
}

/** @internal */
export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// /runs/* — long-lived, observable Run resources
// ─────────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "pending"
  | "running"
  | "draining"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Server-side Run record returned by POST /runs and GET /runs/:id. Fields
 * mirror @agntz/core's `Run` interface — duplicated here so the SDK has no
 * runtime dependency on core.
 */
export interface Run {
  id: string;
  rootId: string;
  parentId?: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  spawnToolUseId?: string;
  status: RunStatus;
  input: string;
  result?: {
    output: string;
    invocationId: string;
    sessionId: string;
    toolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      output: unknown;
      duration: number;
      error?: string;
    }>;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    duration: number;
    model: string;
  };
  error?: string;
  startedAt: number;
  endedAt?: number;
  depth: number;
}

export interface RunsStartInput {
  agentId: string;
  input?: unknown;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface RunsStreamInput {
  runId: string;
  /** Resume from a specific seq (exclusive); useful after reconnect. */
  since?: number;
  signal?: AbortSignal;
}

/** Filter passed to RunsResource.list. `userId` is implicit (auth). */
export interface RunListFilter {
  rootsOnly?: boolean;
  agentId?: string;
  status?: RunStatus;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  cursor?: string;
}

export interface RunListResult {
  rows: Run[];
  cursor?: string;
}

/**
 * Multiplexed event from a Run subtree, as exposed via GET /runs/:id/stream.
 * Mirrors @agntz/core's `MultiplexedEvent` — duplicated to keep the SDK free
 * of a core runtime dep.
 */
export type MultiplexedRunEvent =
  | { type: "run-spawn"; runId: string; parentId?: string; agentId: string; seq: number }
  | { type: "text-delta"; runId: string; text: string; seq: number }
  | { type: "tool-call-start"; runId: string; toolCall: { id: string; name: string }; seq: number }
  | {
      type: "tool-call-end";
      runId: string;
      toolCall: {
        id: string;
        name: string;
        input: unknown;
        output: unknown;
        duration: number;
        error?: string;
      };
      seq: number;
    }
  | {
      type: "step-complete";
      runId: string;
      step: number;
      toolCalls: Array<{
        id: string;
        name: string;
        input: unknown;
        output: unknown;
        duration: number;
        error?: string;
      }>;
      seq: number;
    }
  | { type: "draining"; runId: string; pendingChildren: string[]; seq: number }
  | { type: "run-complete"; runId: string; result: Run["result"]; seq: number }
  | { type: "run-error"; runId: string; error: string; seq: number }
  | { type: "run-cancelled"; runId: string; seq: number }
  /** Emitted when the run has been evicted from memory and only a final snapshot is available. */
  | { type: "snapshot"; run: Run };

// ─── Traces ────────────────────────────────────────────────────────────

export type SpanKind = "run" | "manifest" | "step" | "invoke" | "model" | "tool";
export type SpanStatus = "running" | "ok" | "error" | "cancelled";

export interface Span {
  spanId: string;
  traceId: string;
  parentId: string | null;
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: SpanStatus;
  error: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ ts: string; name: string; data?: unknown }>;
  scores: Record<string, { value: number; reason?: string }>;
  costUsd: number | null;
}

export interface TraceSummary {
  traceId: string;
  ownerId: string;
  rootName: string;
  agentId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanCount: number;
  status: SpanStatus;
  totalTokens: number;
  totalCostUsd: number | null;
}

/** Filter passed to TracesResource.list. `ownerId` is implicit (auth). */
export interface TraceFilter {
  agentId?: string;
  status?: SpanStatus;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  cursor?: string;
}

export type TraceLiveEvent =
  | { type: "span-start"; span: Span }
  | { type: "span-end"; spanId: string; patch: Partial<Span> }
  | { type: "trace-done"; summary: TraceSummary }
  | { type: "snapshot"; summary: TraceSummary; spans: Span[] };

export interface TracesListResult {
  rows: TraceSummary[];
  cursor?: string;
}

export interface TraceDetail {
  summary: TraceSummary;
  spans: Span[];
}
