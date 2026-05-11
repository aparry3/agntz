"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { EvalSuite, EvalSuiteRun } from "@agntz/core";
import { Breadcrumb } from "@/components/breadcrumb";

export default function AgentEvalsPage() {
  const { id } = useParams<{ id: string }>();
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [runs, setRuns] = useState<EvalSuiteRun[]>([]);
  const [rubric, setRubric] = useState("");
  const [suiteName, setSuiteName] = useState("Rubric eval suite");
  const [casesText, setCasesText] = useState("[]");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const selectedSuite = useMemo(
    () => suites.find((suite) => suite.id === selectedSuiteId) ?? null,
    [selectedSuiteId, suites],
  );

  const loadSuites = useCallback(async () => {
    const res = await fetch(`/api/agents/${id}/eval-suites`);
    const data = await res.json();
    setSuites(Array.isArray(data) ? data : []);
    setSelectedSuiteId((current) => current ?? data?.[0]?.id ?? null);
  }, [id]);

  const loadRuns = useCallback(async (suiteId: string | null) => {
    if (!suiteId) {
      setRuns([]);
      return;
    }
    const res = await fetch(`/api/eval-suites/${suiteId}/runs`);
    const data = await res.json();
    setRuns(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    loadSuites()
      .catch((error) => setStatus(`Error: ${String(error)}`))
      .finally(() => setLoading(false));
  }, [loadSuites]);

  useEffect(() => {
    void loadRuns(selectedSuiteId);
  }, [loadRuns, selectedSuiteId]);

  useEffect(() => {
    if (!selectedSuite) return;
    setSuiteName(selectedSuite.name);
    setRubric(selectedSuite.rubric ?? "");
    setCasesText(JSON.stringify(selectedSuite.cases, null, 2));
  }, [selectedSuite]);

  const handleSuggest = async () => {
    if (!rubric.trim()) {
      setStatus("Add a rubric first");
      return;
    }

    setSuggesting(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/agents/${id}/eval-suites/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rubric }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error ?? "Failed to generate eval suite"}`);
        return;
      }
      setSuiteName(data.suite.name);
      setRubric(data.suite.rubric ?? rubric);
      setCasesText(JSON.stringify(data.suite.cases ?? [], null, 2));
      setStatus(data.degraded ? "Created a fallback suite. Add provider keys for AI-generated cases." : "Draft suite generated");
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = async () => {
    let cases: EvalSuite["cases"];
    try {
      cases = JSON.parse(casesText) as EvalSuite["cases"];
      if (!Array.isArray(cases)) throw new Error("Cases must be a JSON array");
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/agents/${id}/eval-suites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suiteName,
          rubric,
          passThreshold: 0.8,
          cases,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error ?? "Failed to save eval suite"}`);
        return;
      }
      await loadSuites();
      setSelectedSuiteId(data.id);
      setStatus("Eval suite saved");
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!selectedSuiteId) return;
    setRunning(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/eval-suites/${selectedSuiteId}/runs`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error ?? "Failed to run eval suite"}`);
        return;
      }
      await loadRuns(selectedSuiteId);
      setStatus(`Run complete: ${data.summary.passed}/${data.summary.total} passed`);
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-zinc-500">Loading evals...</p>
      </div>
    );
  }

  const latestRun = runs[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Agents", href: "/agents" }, { label: id, href: `/agents/${id}` }, { label: "Evals" }]} />

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Evals</h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-600">
            Save rubric-based suites, run them against the active agent version, and inspect deterministic and judge-based results.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/agents/${id}`}
            className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-stone-50"
          >
            Back to agent
          </Link>
          <button
            onClick={handleRun}
            disabled={!selectedSuiteId || running}
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {running ? "Running..." : "Run selected suite"}
          </button>
        </div>
      </div>

      {status && (
        <div
          className={`mb-6 rounded-2xl px-4 py-3 text-sm font-medium ${
            status.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {status}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Suites</h2>
            <div className="mt-4 space-y-2">
              {suites.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
                  No saved eval suites yet.
                </div>
              ) : (
                suites.map((suite) => (
                  <button
                    key={suite.id}
                    onClick={() => setSelectedSuiteId(suite.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      selectedSuiteId === suite.id
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-stone-200 bg-stone-50 text-zinc-900 hover:bg-white"
                    }`}
                  >
                    <span className="block text-sm font-medium">{suite.name}</span>
                    <span className={selectedSuiteId === suite.id ? "mt-1 block text-xs text-zinc-300" : "mt-1 block text-xs text-zinc-500"}>
                      {suite.cases.filter((testCase) => testCase.enabled !== false).length} cases
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Latest Run</h2>
            {latestRun ? (
              <div className="mt-4">
                <div className="text-3xl font-semibold text-zinc-950">
                  {(latestRun.summary.score * 100).toFixed(0)}%
                </div>
                <p className="mt-2 text-sm text-zinc-600">
                  {latestRun.summary.passed}/{latestRun.summary.total} passed
                </p>
                <p className="mt-1 text-xs text-zinc-400">{new Date(latestRun.startedAt).toLocaleString()}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No runs for the selected suite.</p>
            )}
          </section>
        </aside>

        <main className="space-y-6">
          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Create or Refine</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Start with a rubric. Agntz can turn it into draft cases and assertions; you can edit the JSON before saving.
              </p>
            </div>

            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Suite name</label>
            <input
              value={suiteName}
              onChange={(event) => setSuiteName(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:bg-white"
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Rubric</label>
            <textarea
              value={rubric}
              onChange={(event) => setRubric(event.target.value)}
              placeholder="The agent should be accurate, concise, follow the output schema, and avoid unsupported claims."
              className="mt-2 h-32 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white"
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Cases JSON</label>
            <textarea
              value={casesText}
              onChange={(event) => setCasesText(event.target.value)}
              spellCheck={false}
              className="mt-2 h-80 w-full rounded-2xl border border-stone-200 bg-zinc-950 px-4 py-3 font-mono text-xs leading-5 text-zinc-100 outline-none transition focus:border-zinc-500"
            />

            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button
                onClick={handleSuggest}
                disabled={suggesting || !rubric.trim()}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:text-zinc-300"
              >
                {suggesting ? "Generating..." : "Generate from rubric"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !suiteName.trim()}
                className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {saving ? "Saving..." : "Save as new suite"}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Run Results</h2>
            <div className="mt-4 space-y-3">
              {!latestRun ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
                  Run a suite to see case-level results.
                </div>
              ) : (
                latestRun.caseResults.map((result) => (
                  <div key={result.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-zinc-950">{result.name}</h3>
                        <p className="mt-1 text-xs text-zinc-500">
                          {(result.score * 100).toFixed(0)}% score - {result.duration}ms
                        </p>
                      </div>
                      <span className={result.passed ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700"}>
                        {result.passed ? "Passed" : "Failed"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {result.assertions.map((assertion, index) => (
                        <div key={`${assertion.type}-${index}`} className="rounded-xl bg-white px-3 py-2 text-xs text-zinc-600">
                          <span className="font-medium text-zinc-900">{assertion.type}</span>
                          <span className="ml-2">{assertion.reason ?? (assertion.passed ? "Passed" : "Failed")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
