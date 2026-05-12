"use client";

import Link from "next/link";
import type { Run } from "@agntz/core";
import { StatusBadge } from "@/components/status-badge";
import { RelativeTime } from "@/components/relative-time";

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function usageSummary(run: Run): string {
  // Until model-pricing is plumbed through, show a token-count summary in
  // place of a $ cost. The Usage column header reflects this (spec §12 TBD).
  const usage = run.result?.usage;
  if (!usage) return "—";
  const k = usage.totalTokens / 1000;
  return k >= 1 ? `${k.toFixed(1)}k tok` : `${usage.totalTokens} tok`;
}

export function RunsTable({ rows }: { rows: Run[] }) {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Agent</th>
            <th className="px-4 py-3 text-left font-medium">Input</th>
            <th className="px-4 py-3 text-left font-medium">Started</th>
            <th className="px-4 py-3 text-right font-medium">Duration</th>
            <th className="px-4 py-3 text-right font-medium">Usage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((row) => {
            const dur = row.endedAt && row.startedAt ? row.endedAt - row.startedAt : null;
            return (
              <tr key={row.id} className="transition hover:bg-stone-50">
                <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-900">{row.agentId}</td>
                <td className="px-4 py-3 text-zinc-700">
                  <Link href={`/runs/${row.id}`} className="hover:underline">
                    {truncate(row.input, 80)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600"><RelativeTime iso={new Date(row.startedAt).toISOString()} /></td>
                <td className="px-4 py-3 text-right text-zinc-700 font-mono text-xs">{formatDurationMs(dur)}</td>
                <td className="px-4 py-3 text-right text-zinc-700 font-mono text-xs">{usageSummary(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
