"use client";

import type { Span, TraceSummary } from "@agntz/core";
import { kindBgColor } from "@/components/kind-icon";

export function GanttStrip({
  spans,
  summary,
  selectedSpanId,
  onSelect,
}: {
  spans: Span[];
  summary: TraceSummary;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}) {
  const traceStart = Date.parse(summary.startedAt);
  const traceEndIso = summary.endedAt ?? new Date(Date.now()).toISOString();
  const traceEnd = Date.parse(traceEndIso);
  const totalMs = Math.max(1, traceEnd - traceStart);

  // Sort by startedAt for stable visual ordering. Spans with the same
  // startedAt fall back to spanId for determinism.
  const sorted = [...spans].sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.spanId.localeCompare(b.spanId),
  );

  // Compute depth via a parent-id walk. Spans whose parent isn't in the set
  // are treated as depth 0 (defensive).
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const depthCache = new Map<string, number>();
  const depthOf = (s: Span): number => {
    const cached = depthCache.get(s.spanId);
    if (cached !== undefined) return cached;
    if (!s.parentId) {
      depthCache.set(s.spanId, 0);
      return 0;
    }
    const parent = byId.get(s.parentId);
    const d = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(s.spanId, d);
    return d;
  };

  return (
    <div className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-sm">
      <div className="space-y-1">
        {sorted.map((span) => {
          const depth = depthOf(span);
          const leftPct = ((Date.parse(span.startedAt) - traceStart) / totalMs) * 100;
          const widthMs = span.durationMs ?? Math.max(0, Date.now() - Date.parse(span.startedAt));
          const widthPct = Math.max(0.2, (widthMs / totalMs) * 100);
          const isSelected = span.spanId === selectedSpanId;
          return (
            <button
              type="button"
              key={span.spanId}
              onClick={() => onSelect(span.spanId)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-stone-50 ${
                isSelected ? "bg-stone-100 ring-1 ring-stone-300" : ""
              }`}
            >
              <span
                className="w-64 truncate font-mono text-zinc-700"
                style={{ paddingLeft: `${depth * 12}px` }}
              >
                {span.name}
              </span>
              <span className="relative h-3 flex-1 rounded bg-stone-100">
                <span
                  className={`absolute top-0 h-3 rounded ${kindBgColor(span.kind)} ${
                    span.status === "running" ? "animate-pulse opacity-80" : ""
                  }`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </span>
              <span className="w-16 text-right tabular-nums text-zinc-500">
                {formatMs(widthMs)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
