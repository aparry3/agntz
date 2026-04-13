"use client";

import { useEffect, useState } from "react";

interface Session {
  sessionId: string;
  agentId?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Sessions</h1>
        <p className="mt-2 text-sm text-zinc-600">Browse stored conversation sessions and recent activity.</p>
      </div>
      {loading ? (
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">Loading...</div>
      ) : sessions.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-stone-300 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">No sessions yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="font-mono text-sm text-zinc-900">{s.sessionId}</div>
              {s.agentId && (
                <div className="mt-2 text-sm text-zinc-600">Agent: {s.agentId}</div>
              )}
              <div className="mt-2 text-sm text-zinc-500">
                {s.messageCount} messages &middot; {new Date(s.updatedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
