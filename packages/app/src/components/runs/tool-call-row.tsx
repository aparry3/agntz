"use client";

import { useState } from "react";
import { JsonView } from "@/components/json-view";

export interface RunToolCall {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  duration: number;
  error?: string;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallRow({ toolCall }: { toolCall: RunToolCall }) {
  const [open, setOpen] = useState(false);
  const errored = !!toolCall.error;
  return (
    <div className={`rounded-2xl border ${errored ? "border-rose-200 bg-rose-50" : "border-stone-200 bg-white"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
      >
        <span className="text-zinc-400">→</span>
        <span className={`font-mono ${errored ? "text-rose-800" : "text-zinc-800"}`}>{toolCall.name}</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">{formatDurationMs(toolCall.duration)}</span>
        <span className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-stone-200 px-4 py-3 text-xs">
          <div className="mb-2">
            <div className="mb-1 uppercase tracking-wider text-zinc-500">Input</div>
            <JsonView data={toolCall.input} />
          </div>
          <div className="mb-2">
            <div className="mb-1 uppercase tracking-wider text-zinc-500">Output</div>
            <JsonView data={toolCall.output} />
          </div>
          {errored && (
            <div>
              <div className="mb-1 uppercase tracking-wider text-rose-700">Error</div>
              <pre className="whitespace-pre-wrap text-rose-900">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
