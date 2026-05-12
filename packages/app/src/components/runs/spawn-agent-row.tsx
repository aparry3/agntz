"use client";

import Link from "next/link";
import type { RunToolCall } from "./tool-call-row";
import { ToolCallRow } from "./tool-call-row";

interface SpawnedRunRef {
  runId: string;
  agentId?: string;
}

function parseSpawnOutput(output: unknown): SpawnedRunRef | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  // Common shapes: { runId, agentId } or { run: { id, agentId } }
  if (typeof o.runId === "string") {
    return { runId: o.runId, agentId: typeof o.agentId === "string" ? o.agentId : undefined };
  }
  if (o.run && typeof o.run === "object") {
    const r = o.run as Record<string, unknown>;
    if (typeof r.id === "string") {
      return { runId: r.id, agentId: typeof r.agentId === "string" ? r.agentId : undefined };
    }
  }
  return null;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SpawnAgentRow({ toolCall }: { toolCall: RunToolCall }) {
  const ref = parseSpawnOutput(toolCall.output);
  if (!ref) {
    // Unexpected shape — fall back to the regular tool-call rendering.
    return <ToolCallRow toolCall={toolCall} />;
  }
  return (
    <Link
      href={`/runs/${encodeURIComponent(ref.runId)}`}
      className="block rounded-2xl border-l-4 border-l-violet-400 border-y border-r border-stone-200 bg-white px-4 py-3 transition hover:border-stone-300"
    >
      <div className="flex items-center gap-3 text-sm">
        <span className="text-violet-500">↳</span>
        <span className="text-zinc-500">spawned</span>
        <span className="font-mono text-zinc-900">{ref.agentId ?? "(agent)"}</span>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {formatDurationMs(toolCall.duration)}
        </span>
        <span className="font-mono text-xs text-violet-600">→</span>
      </div>
    </Link>
  );
}
