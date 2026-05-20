import type {
  Run,
  RunListFilter,
  RunListResult,
  Span,
  SpanStatus,
  TraceDetail,
  TraceFilter,
  TraceSummary,
  TracesListResult,
} from "@agntz/sdk";
import type { InvokeResult } from "@agntz/core";

/**
 * Fixed-capacity ring buffer. The newest entry is at the end of the
 * returned `list()` array; once `capacity` is exceeded the oldest entry
 * drops off. Per-id lookup is O(n) — fine for the modest buffer sizes
 * the embedded runner is meant for.
 */
class RingBuffer<T> {
  private readonly items: T[] = [];
  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  all(): T[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }
}

export interface RunsBufferOptions {
  capacity?: number;
}

/**
 * In-memory record of every invocation that ran through this client.
 * Exposes the SDK-shaped `.list/.get` surface so consumers written
 * against the hosted client work locally.
 */
export class RunsBuffer {
  private readonly buf: RingBuffer<Run>;
  constructor(opts: RunsBufferOptions = {}) {
    this.buf = new RingBuffer<Run>(opts.capacity ?? 1000);
  }

  record(run: Run): void {
    this.buf.push(run);
  }

  list(filter: RunListFilter = {}): RunListResult {
    let rows = this.buf.all().reverse(); // newest first
    if (filter.agentId) rows = rows.filter((r) => r.agentId === filter.agentId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.rootsOnly) rows = rows.filter((r) => r.rootId === r.id);
    if (filter.startedAfter) {
      const t = Date.parse(filter.startedAfter);
      rows = rows.filter((r) => r.startedAt >= t);
    }
    if (filter.startedBefore) {
      const t = Date.parse(filter.startedBefore);
      rows = rows.filter((r) => r.startedAt <= t);
    }
    if (filter.limit && filter.limit > 0) rows = rows.slice(0, filter.limit);
    return { rows };
  }

  get(id: string): Run | null {
    return this.buf.all().find((r) => r.id === id) ?? null;
  }
}

export interface TracesBufferOptions {
  capacity?: number;
}

/**
 * In-memory trace store. Each invocation produces one trace with a
 * synthesized root span and one child span per tool call — enough to
 * mirror the SDK's `.traces.list/get` shape without persisting to disk.
 */
export class TracesBuffer {
  private readonly buf: RingBuffer<{ summary: TraceSummary; spans: Span[] }>;
  constructor(opts: TracesBufferOptions = {}) {
    this.buf = new RingBuffer<{ summary: TraceSummary; spans: Span[] }>(opts.capacity ?? 1000);
  }

  record(trace: { summary: TraceSummary; spans: Span[] }): void {
    this.buf.push(trace);
  }

  list(filter: TraceFilter = {}): TracesListResult {
    let rows = this.buf.all().map((t) => t.summary).reverse();
    if (filter.agentId) rows = rows.filter((r) => r.agentId === filter.agentId);
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.startedAfter) {
      const t = Date.parse(filter.startedAfter);
      rows = rows.filter((r) => Date.parse(r.startedAt) >= t);
    }
    if (filter.startedBefore) {
      const t = Date.parse(filter.startedBefore);
      rows = rows.filter((r) => Date.parse(r.startedAt) <= t);
    }
    if (filter.limit && filter.limit > 0) rows = rows.slice(0, filter.limit);
    return { rows };
  }

  get(traceId: string): TraceDetail | null {
    const found = this.buf.all().find((t) => t.summary.traceId === traceId);
    if (!found) return null;
    return { summary: found.summary, spans: found.spans };
  }
}

/**
 * Build a Run record (SDK shape) from a completed invocation. `inputAsString`
 * is the flattened text view of the user's input (list UIs display it).
 */
export function buildRunRecord(args: {
  runId: string;
  agentId: string;
  inputAsString: string;
  status: "completed" | "failed";
  result?: InvokeResult;
  error?: string;
  startedAt: number;
  endedAt: number;
}): Run {
  return {
    id: args.runId,
    rootId: args.runId,
    agentId: args.agentId,
    sessionId: args.result?.sessionId,
    status: args.status,
    input: args.inputAsString,
    result: args.result
      ? {
          output: args.result.output,
          invocationId: args.result.invocationId,
          sessionId: args.result.sessionId,
          toolCalls: args.result.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            input: tc.input,
            output: tc.output,
            duration: tc.duration,
            error: tc.error,
          })),
          usage: args.result.usage,
          duration: args.result.duration,
          model: args.result.model,
        }
      : undefined,
    error: args.error,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    depth: 0,
  };
}

/**
 * Synthesize a single-trace view from a completed invocation. The trace
 * has one root span representing the run plus one child span per tool
 * call — a thin but useful approximation of what the hosted telemetry
 * pipeline produces.
 */
export function buildTraceFromInvocation(args: {
  runId: string;
  agentId: string;
  result?: InvokeResult;
  error?: string;
  startedAt: number;
  endedAt: number;
}): { summary: TraceSummary; spans: Span[] } {
  const traceId = args.runId;
  const startedAtIso = new Date(args.startedAt).toISOString();
  const endedAtIso = new Date(args.endedAt).toISOString();
  const durationMs = args.endedAt - args.startedAt;
  const status: SpanStatus = args.error ? "error" : "ok";
  const ownerId = "embedded";
  const totalTokens = args.result?.usage.totalTokens ?? 0;

  const rootSpan: Span = {
    spanId: `${traceId}-root`,
    traceId,
    parentId: null,
    ownerId,
    runId: args.runId,
    sessionId: args.result?.sessionId ?? null,
    name: args.agentId,
    kind: "run",
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    durationMs,
    status,
    error: args.error ?? null,
    attributes: {
      model: args.result?.model,
      promptTokens: args.result?.usage.promptTokens,
      completionTokens: args.result?.usage.completionTokens,
    },
    events: [],
    scores: {},
    costUsd: null,
  };

  const toolSpans: Span[] = (args.result?.toolCalls ?? []).map((tc, i) => ({
    spanId: `${traceId}-tool-${i}`,
    traceId,
    parentId: rootSpan.spanId,
    ownerId,
    runId: args.runId,
    sessionId: args.result?.sessionId ?? null,
    name: tc.name,
    kind: "tool",
    startedAt: startedAtIso,
    endedAt: new Date(args.startedAt + tc.duration).toISOString(),
    durationMs: tc.duration,
    status: tc.error ? "error" : "ok",
    error: tc.error ?? null,
    attributes: { input: tc.input, output: tc.output },
    events: [],
    scores: {},
    costUsd: null,
  }));

  const summary: TraceSummary = {
    traceId,
    ownerId,
    rootName: args.agentId,
    agentId: args.agentId,
    startedAt: startedAtIso,
    endedAt: endedAtIso,
    durationMs,
    spanCount: 1 + toolSpans.length,
    status,
    totalTokens,
    totalCostUsd: null,
  };

  return { summary, spans: [rootSpan, ...toolSpans] };
}
