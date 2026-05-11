"use client";

import { useState } from "react";
import type { Span } from "@agntz/core";
import { KindIcon } from "@/components/kind-icon";
import { StatusBadge } from "@/components/status-badge";

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
    <div className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        Span tree
      </div>
      <div className="mt-3 space-y-0.5">
        {roots.map((root) => (
          <TreeNode
            key={root.spanId}
            span={root}
            children={childrenByParent}
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
  children,
  depth,
  selectedSpanId,
  onSelect,
}: {
  span: Span;
  children: Map<string | null, Span[]>;
  depth: number;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const kids = children.get(span.spanId) ?? [];
  const hasKids = kids.length > 0;
  const isSelected = span.spanId === selectedSpanId;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition hover:bg-stone-50 ${
          isSelected ? "bg-stone-100 ring-1 ring-stone-300" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-4 text-zinc-400 hover:text-zinc-900"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▼" : "▶"}
          </button>
        ) : (
          <span className="inline-block w-4" />
        )}
        <KindIcon kind={span.kind} />
        <button
          type="button"
          onClick={() => onSelect(span.spanId)}
          className="flex-1 truncate text-left font-mono text-zinc-900"
        >
          {span.name}
        </button>
        <StatusBadge status={span.status} />
      </div>
      {hasKids && open && (
        <div>
          {kids.map((kid) => (
            <TreeNode
              key={kid.spanId}
              span={kid}
              children={children}
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
