"use client";

import Link from "next/link";
import type { Run } from "@agntz/core";
import { StatusBadge } from "@/components/status-badge";
import { RelativeTime } from "@/components/relative-time";
import { CancelButton } from "./cancel-button";

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RunHeader({ run }: { run: Run }) {
  const dur = run.endedAt && run.startedAt ? run.endedAt - run.startedAt : null;
  return (
    <header className="mb-8">
      <Link href="/runs" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Runs
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            <span className="font-mono text-zinc-700">{run.agentId}</span>
            <span className="mx-2 text-zinc-300">·</span>
            <span className="font-mono text-base text-zinc-500">{run.id}</span>
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-zinc-600">
            <StatusBadge status={run.status} />
            <span>·</span>
            <RelativeTime iso={new Date(run.startedAt).toISOString()} />
            <span>·</span>
            <span className="font-mono text-xs">{formatDurationMs(dur)}</span>
          </div>
        </div>
        {(run.status === "pending" ||
          run.status === "running" ||
          run.status === "draining") && <CancelButton runId={run.id} />}
      </div>
    </header>
  );
}
