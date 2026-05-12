"use client";

import { useEffect, useState } from "react";
import type { Run } from "@agntz/core";

const TERMINAL: ReadonlyArray<Run["status"]> = ["completed", "failed", "cancelled"];

/**
 * Returns the latest Run, polling /api/runs/[runId] every 2s while the run
 * is non-terminal. Stops polling once a terminal status is observed.
 */
export function useRunPolling(initial: Run): { run: Run; error: string | null } {
  const [run, setRun] = useState<Run>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (TERMINAL.includes(run.status)) return;

    let cancelled = false;
    const handle = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(initial.id)}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const next = (await res.json()) as Run;
        if (cancelled) return;
        setRun(next);
        setError(null);
        if (TERMINAL.includes(next.status)) clearInterval(handle);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // initial.id stable for the page lifetime; run.status drives the start/stop guard
  }, [initial.id, run.status]);

  return { run, error };
}
