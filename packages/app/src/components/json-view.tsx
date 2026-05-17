"use client";

import { useState } from "react";
import { ag } from "@/components/v3/primitives";

export function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null) return <Literal text="null" color={ag.muted} />;
  if (data === undefined) return <Literal text="undefined" color={ag.muted} />;
  if (typeof data === "boolean") return <Literal text={String(data)} color={ag.warn} />;
  if (typeof data === "number") return <Literal text={String(data)} color={ag.ok} />;
  if (typeof data === "string") return <Literal text={`"${data}"`} color={ag.blue} />;
  if (Array.isArray(data)) return <ArrayView items={data} depth={depth} />;
  if (typeof data === "object") return <ObjectView obj={data as Record<string, unknown>} depth={depth} />;
  return <Literal text={String(data)} color={ag.ink} />;
}

function Literal({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        color,
      }}
    >
      {text}
    </span>
  );
}

function Toggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        background: "transparent",
        border: 0,
        padding: 0,
        cursor: "pointer",
        color: ag.muted,
      }}
    >
      {open ? "▼" : "▶"} {label}
    </button>
  );
}

function ObjectView({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(obj);
  const [open, setOpen] = useState(depth < 2);
  if (entries.length === 0) return <Literal text="{}" color={ag.muted} />;
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.7 }}>
      <Toggle
        open={open}
        onClick={() => setOpen((v) => !v)}
        label={`${entries.length} ${entries.length === 1 ? "key" : "keys"}`}
      />
      {open && (
        <div style={{ marginLeft: 14, borderLeft: `1px solid ${ag.line2}`, paddingLeft: 10 }}>
          {entries.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ color: ag.text2 }}>{k}:</span>
              <JsonView data={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrayView({ items, depth }: { items: unknown[]; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (items.length === 0) return <Literal text="[]" color={ag.muted} />;
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.7 }}>
      <Toggle
        open={open}
        onClick={() => setOpen((v) => !v)}
        label={`${items.length} ${items.length === 1 ? "item" : "items"}`}
      />
      {open && (
        <div style={{ marginLeft: 14, borderLeft: `1px solid ${ag.line2}`, paddingLeft: 10 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ color: ag.text2 }}>[{i}]</span>
              <JsonView data={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
