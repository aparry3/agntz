"use client";

import { useState } from "react";
import type { Span, SpanStatus } from "@agntz/core";
import { KindIcon } from "@/components/kind-icon";
import { Mono, ag } from "@/components/v3/primitives";

export function SpanTree({
  spans,
  selectedSpanId,
  onSelect,
}: {
  spans: Span[];
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}) {
  const childrenByParent = new Map<string | null, Span[]>();
  for (const s of spans) {
    const key = s.parentId;
    const list = childrenByParent.get(key) ?? [];
    list.push(s);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort(
      (a, b) =>
        Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.spanId.localeCompare(b.spanId),
    );
  }
  const roots = childrenByParent.get(null) ?? [];

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
        <span>Span tree</span>
        <Mono size={10.5} color={ag.muted}>
          {spans.length} {spans.length === 1 ? "span" : "spans"}
        </Mono>
      </div>
      <div style={{ padding: "6px 4px 8px" }}>
        {roots.map((root) => (
          <TreeNode
            key={root.spanId}
            span={root}
            childrenByParent={childrenByParent}
            depth={0}
            selectedSpanId={selectedSpanId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNode({
  span,
  childrenByParent,
  depth,
  selectedSpanId,
  onSelect,
}: {
  span: Span;
  childrenByParent: Map<string | null, Span[]>;
  depth: number;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const kids = childrenByParent.get(span.spanId) ?? [];
  const hasKids = kids.length > 0;
  const isSelected = span.spanId === selectedSpanId;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          paddingLeft: depth * 16 + 10,
          borderRadius: 4,
          fontSize: 12.5,
          cursor: "pointer",
          background: isSelected ? ag.surfaceWarm : "transparent",
          boxShadow: isSelected ? `inset 0 0 0 1px ${ag.line}` : undefined,
        }}
        onClick={() => onSelect(span.spanId)}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = ag.surfaceWarm;
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            style={{
              width: 12,
              border: 0,
              background: "transparent",
              color: ag.muted,
              cursor: "pointer",
              fontSize: 9,
              padding: 0,
              fontFamily: "inherit",
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▼" : "▶"}
          </button>
        ) : (
          <span style={{ width: 12, display: "inline-block" }} />
        )}
        <KindIcon kind={span.kind} />
        <Mono
          size={12}
          color={ag.ink}
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {span.name}
        </Mono>
        <StatusChip status={span.status} />
      </div>
      {hasKids && open && (
        <div>
          {kids.map((kid) => (
            <TreeNode
              key={kid.spanId}
              span={kid}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              selectedSpanId={selectedSpanId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: SpanStatus }) {
  const M: Record<SpanStatus, { bg: string; fg: string; label: string; pulse?: boolean }> = {
    ok:        { bg: ag.okBg, fg: ag.ok, label: "OK" },
    error:     { bg: "#F2DCDE", fg: ag.danger, label: "Error" },
    cancelled: { bg: ag.line2, fg: ag.text2, label: "Cancelled" },
    running:   { bg: ag.blueBg, fg: ag.blue, label: "Running", pulse: true },
  };
  const m = M[status] ?? { bg: ag.line2, fg: ag.text2, label: status };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: m.bg,
        color: m.fg,
        padding: "1px 6px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: m.fg,
          animation: m.pulse ? "agntz-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      {m.label}
    </span>
  );
}
