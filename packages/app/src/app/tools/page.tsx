"use client";

import { useEffect, useState } from "react";

interface ToolInfo {
  name: string;
  description: string;
  source: string;
  inputSchema: Record<string, unknown>;
}

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then(setTools)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Tools</h1>
        <p className="mt-2 text-sm text-zinc-600">Review registered tools and where they come from.</p>
      </div>
      {loading ? (
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">Loading...</div>
      ) : tools.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-stone-300 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">No tools registered.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
            >
              <div className="font-mono text-sm font-medium text-zinc-950">{tool.name}</div>
              <div className="mt-2 text-sm leading-6 text-zinc-600">{tool.description}</div>
              <div className="mt-2 text-xs text-zinc-500">Source: {tool.source}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
