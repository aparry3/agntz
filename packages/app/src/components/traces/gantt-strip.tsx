"use client";

import type { Span, TraceSummary } from "@agntz/core";
import { KindIcon, kindColor } from "@/components/kind-icon";
import { Mono, ag } from "@/components/v3/primitives";

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
  const traceEndIso = summary.endedAt ?? new Date().toISOString();
  const traceEnd = Date.parse(traceEndIso);
  const totalMs = Math.max(1, traceEnd - traceStart);

  const sorted = [...spans].sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.spanId.localeCompare(b.spanId),
  );

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
    <div
      style={{
        background: ag.surface2,
        border: `1px solid ${ag.line}`,
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "9px 14px",
          background: ag.surface,
          borderBottom: `1px solid ${ag.line}`,
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: ag.muted,
          fontWeight: 500,
        }}
      >
        <span>Timeline</span>
        <Mono size={10.5} color={ag.muted}>
          {formatMs(totalMs)} total
        </Mono>
      </div>
      <div style={{ padding: "10px 12px" }}>
        {sorted.map((span) => {
          const depth = depthOf(span);
          const leftPct = ((Date.parse(span.startedAt) - traceStart) / totalMs) * 100;
          const widthMs = span.durationMs ?? Math.max(0, Date.now() - Date.parse(span.startedAt));
          const widthPct = Math.max(0.4, (widthMs / totalMs) * 100);
          const isSelected = span.spanId === selectedSpanId;
          return (
            <button
              type="button"
              key={span.spanId}
              onClick={() => onSelect(span.spanId)}
              style={{
                display: "grid",
                gridTemplateColumns: "240px 1fr 64px",
                gap: 10,
                alignItems: "center",
                padding: "5px 8px",
                border: 0,
                background: isSelected ? ag.surfaceWarm : "transparent",
                boxShadow: isSelected ? `inset 0 0 0 1px ${ag.line}` : undefined,
                width: "100%",
                cursor: "pointer",
                fontFamily: "inherit",
                borderRadius: 4,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = ag.surfaceWarm;
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  overflow: "hidden",
                  paddingLeft: depth * 12,
                }}
              >
                <KindIcon kind={span.kind} />
                <Mono
                  size={11.5}
                  color={ag.text2}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {span.name}
                </Mono>
              </span>
              <span
                style={{
                  position: "relative",
                  height: 12,
                  borderRadius: 3,
                  background: ag.line2,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    height: 12,
                    borderRadius: 3,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    background: kindColor(span.kind),
                    opacity: 0.85,
                    animation: span.status === "running" ? "agntz-pulse 1.4s ease-in-out infinite" : undefined,
                  }}
                />
              </span>
              <Mono
                size={10.5}
                color={ag.muted}
                style={{ width: 64, textAlign: "right", display: "block" }}
              >
                {formatMs(widthMs)}
              </Mono>
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
