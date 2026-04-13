"use client";

import { useEffect, useState } from "react";

interface LogEntry {
  id: string;
  agentId: string;
  input: string;
  output: string;
  duration: number;
  model: string;
  timestamp: string;
  error?: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/logs")
      .then((r) => r.json())
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Logs</h1>
        <p className="mt-2 text-sm text-zinc-600">Inspect invocation history, runtime, and failures.</p>
      </div>
      {loading ? (
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-stone-300 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">No invocation logs yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-2 flex justify-between gap-3">
                <span className="font-medium text-zinc-950">{log.agentId}</span>
                <span className="text-sm text-zinc-500">
                  {log.duration}ms &middot; {log.model}
                </span>
              </div>
              <div className="text-sm text-zinc-600 truncate">
                Input: {log.input}
              </div>
              <div className="mt-1 text-sm text-zinc-600 truncate">
                Output: {log.output}
              </div>
              {log.error && (
                <div className="mt-2 text-sm text-red-600">Error: {log.error}</div>
              )}
              <div className="mt-2 text-xs text-zinc-500">
                {new Date(log.timestamp).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
