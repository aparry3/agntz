"use client";

import { useState } from "react";

/**
 * Minimal recursive JSON renderer for span attributes and event payloads.
 * Objects and arrays are collapsible (start collapsed at depth ≥ 2).
 */
export function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null) return <Literal text="null" className="text-zinc-400" />;
  if (data === undefined) return <Literal text="undefined" className="text-zinc-400" />;
  if (typeof data === "boolean") {
    return <Literal text={String(data)} className="text-amber-700" />;
  }
  if (typeof data === "number") {
    return <Literal text={String(data)} className="text-emerald-700" />;
  }
  if (typeof data === "string") {
    return <Literal text={`"${data}"`} className="text-blue-700" />;
  }
  if (Array.isArray(data)) {
    return <ArrayView items={data} depth={depth} />;
  }
  if (typeof data === "object") {
    return <ObjectView obj={data as Record<string, unknown>} depth={depth} />;
  }
  return <Literal text={String(data)} className="text-zinc-700" />;
}

function Literal({ text, className }: { text: string; className: string }) {
  return <span className={`font-mono text-xs ${className}`}>{text}</span>;
}

function ObjectView({ obj, depth }: { obj: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(obj);
  const [open, setOpen] = useState(depth < 2);
  if (entries.length === 0) return <Literal text="{}" className="text-zinc-400" />;
  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-zinc-500 hover:text-zinc-900"
      >
        {open ? "▼" : "▶"} {entries.length} {entries.length === 1 ? "key" : "keys"}
      </button>
      {open && (
        <div className="ml-4 border-l border-stone-200 pl-3">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-zinc-600">{k}:</span>
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
  if (items.length === 0) return <Literal text="[]" className="text-zinc-400" />;
  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-zinc-500 hover:text-zinc-900"
      >
        {open ? "▼" : "▶"} {items.length} {items.length === 1 ? "item" : "items"}
      </button>
      {open && (
        <div className="ml-4 border-l border-stone-200 pl-3">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-zinc-600">[{i}]</span>
              <JsonView data={item} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
