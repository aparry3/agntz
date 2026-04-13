"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

interface RunResult {
  output: unknown;
  state: Record<string, unknown>;
}

export default function PlaygroundPage() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, input }),
      });

      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Unknown error");
      } else {
        setResult(body);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Playground</h1>
      <p className="mb-6 mt-2 text-sm text-zinc-600">Agent: {id}</p>

      <form onSubmit={handleRun} className="mb-6 rounded-[2rem] border border-stone-200 bg-white p-6 shadow-sm">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter input (string or JSON)..."
          className="mb-3 h-32 w-full rounded-2xl border border-stone-200 bg-stone-50 p-4 font-mono text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={running}
          className="rounded-xl bg-zinc-950 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
        >
          {running ? "Running..." : "Run"}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="mb-1 text-sm font-medium text-red-700">Error</div>
          <pre className="whitespace-pre-wrap text-sm text-red-700">{error}</pre>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="mb-2 text-sm font-medium text-zinc-600">Output</h2>
            <pre className="max-h-96 overflow-auto rounded-2xl border border-stone-200 bg-white p-4 text-sm whitespace-pre-wrap shadow-sm">
              {typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output, null, 2)}
            </pre>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-zinc-600">State</h2>
            <pre className="max-h-64 overflow-auto rounded-2xl border border-stone-200 bg-white p-4 text-sm whitespace-pre-wrap shadow-sm">
              {JSON.stringify(result.state, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
