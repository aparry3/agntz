"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface AgentSummary {
  id: string;
  name: string;
  description?: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AgentSummary | null>(null);

  const loadAgents = () => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then(setAgents)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAgents();
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/agents/${deleteTarget.id}`, { method: "DELETE" });
    setDeleteTarget(null);
    loadAgents();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Agents</h1>
          <p className="mt-2 text-sm text-zinc-600">Create, inspect, and revise agent definitions.</p>
        </div>
        <Link
          href="/agents/new"
          className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          New Agent
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
          <p className="text-zinc-500">Loading agents...</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
            <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-medium text-zinc-900">No agents yet</h2>
          <p className="mb-4 text-sm text-zinc-500">Create your first agent to get started.</p>
          <Link
            href="/agents/new"
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Create your first agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <div key={agent.id} className="group relative">
              <Link
                href={`/agents/${agent.id}`}
                className="block h-full rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300"
              >
                <div className="font-medium text-zinc-950">{agent.name}</div>
                <div className="mt-1 font-mono text-xs text-zinc-500">{agent.id}</div>
                {agent.description && (
                  <div className="mt-3 text-sm leading-6 text-zinc-600 line-clamp-3">
                    {agent.description}
                  </div>
                )}
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteTarget(agent);
                }}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/90 text-zinc-400 opacity-0 transition-all hover:border-red-200 hover:text-red-500 group-hover:opacity-100"
                title="Delete agent"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Agent"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? deleteTarget?.id}"? All versions will be permanently removed.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
