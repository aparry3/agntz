import type { Span, TraceDetail, TraceLiveEvent, TraceSummary } from "@agntz/client";
import type { TracesBuffer } from "./buffers.js";

interface PendingTrace {
  rootSpanId: string;
  summary: TraceSummary;
  spans: Map<string, Span>;
}

/**
 * Build a TraceSink that collects span-start / span-end events from the
 * core's SpanEmitter and aggregates them into `TraceDetail` records pushed
 * into the runner's in-memory `TracesBuffer`.
 *
 * The SpanEmitter only emits `span-start` and `span-end` (the `trace-done`
 * event is owned by the hosted TraceRegistry, not the emitter). We infer
 * completion by tracking each trace's root span (parentId === null) and
 * finalizing the trace when the root ends.
 */
export function createTraceAggregator(buffer: TracesBuffer): (event: TraceLiveEvent) => void {
  const pending = new Map<string, PendingTrace>();

  return (event: TraceLiveEvent) => {
    switch (event.type) {
      case "span-start": {
        const span = event.span;
        let trace = pending.get(span.traceId);
        if (!trace) {
          trace = {
            rootSpanId: span.parentId == null ? span.spanId : "",
            summary: createSummaryFromRootSpan(span),
            spans: new Map<string, Span>(),
          };
          pending.set(span.traceId, trace);
        } else if (!trace.rootSpanId && span.parentId == null) {
          trace.rootSpanId = span.spanId;
          trace.summary = createSummaryFromRootSpan(span);
        }
        trace.spans.set(span.spanId, { ...span });
        break;
      }
      case "span-end": {
        for (const trace of pending.values()) {
          const existing = trace.spans.get(event.spanId);
          if (!existing) continue;
          const merged = { ...existing, ...event.patch };
          trace.spans.set(event.spanId, merged);

          if (event.spanId === trace.rootSpanId) {
            const summary: TraceSummary = {
              ...trace.summary,
              endedAt: merged.endedAt ?? trace.summary.endedAt,
              durationMs: merged.durationMs ?? trace.summary.durationMs,
              status: merged.status ?? trace.summary.status,
              spanCount: trace.spans.size,
              totalTokens: sumTokens(trace.spans),
            };
            const detail: TraceDetail = { summary, spans: [...trace.spans.values()] };
            buffer.record(detail);
            pending.delete(merged.traceId);
          }
          break;
        }
        break;
      }
      case "trace-done": {
        // Hosted servers emit this; embedded mode infers from root-span end.
        const entry = pending.get(event.summary.traceId);
        if (!entry) return;
        buffer.record({
          summary: { ...entry.summary, ...event.summary },
          spans: [...entry.spans.values()],
        });
        pending.delete(event.summary.traceId);
        break;
      }
    }
  };
}

function createSummaryFromRootSpan(span: Span): TraceSummary {
  return {
    traceId: span.traceId,
    ownerId: span.ownerId,
    rootName: span.name,
    agentId: (span.attributes["agent.id"] as string | undefined) ?? null,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    durationMs: span.durationMs,
    spanCount: 1,
    status: span.status,
    totalTokens: 0,
    totalCostUsd: null,
  };
}

function sumTokens(spans: Map<string, Span>): number {
  let total = 0;
  for (const s of spans.values()) {
    const t = s.attributes["agent.usage.total_tokens"];
    if (typeof t === "number") total += t;
  }
  return total;
}
