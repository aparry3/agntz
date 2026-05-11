"use client";

import Link from "next/link";
import type { TraceSummary } from "@agntz/core";
import { StatusBadge } from "@/components/status-badge";
import { RelativeTime } from "@/components/relative-time";

export function TraceTable({ rows }: { rows: TraceSummary[] }) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Trace</th>
            <th className="px-4 py-3 text-left font-medium">Agent</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Started</th>
            <th className="px-4 py-3 text-right font-medium">Duration</th>
            <th className="px-4 py-3 text-right font-medium">Spans</th>
            <th className="px-4 py-3 text-right font-medium">Tokens</th>
            <th className="px-4 py-3 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row) => (
            <tr key={row.traceId} className="transition hover:bg-stone-50">
              <td className="px-4 py-3">
                <Link
                  href={`/traces/${row.traceId}`}
                  className="font-mono text-xs text-zinc-900 hover:underline"
                >
                  {row.traceId}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-700">{row.agentId ?? "—"}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 text-zinc-700">
                <RelativeTime iso={row.startedAt} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                {formatDuration(row.durationMs)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-700">{row.spanCount}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                {row.totalTokens.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                {row.totalCostUsd === null ? "—" : `$${row.totalCostUsd.toFixed(4)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
