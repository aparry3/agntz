"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { Breadcrumb } from "@/components/breadcrumb";
import { PanelToggle } from "@/components/panel-toggle";
import { ValidationBanner } from "@/components/validation-banner";

interface ValidationError {
  level: string;
  path: string;
  message: string;
}

interface ValidationWarning {
  path: string;
  message: string;
}

interface ExampleEntry {
  input: string;
  output: string;
}

type EditorMode = "yaml" | "instruction" | "both";

const DEFAULT_MANIFEST = `id: my-agent
name: My Agent
kind: llm

model:
  provider: openai
  name: gpt-4o

instruction: |
  You are a helpful assistant.
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default function NewAgentPage() {
  const router = useRouter();

  const [manifest, setManifest] = useState("");
  const [instruction, setInstruction] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("New Agent");
  const [supportsInstruction, setSupportsInstruction] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("both");

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const [examples, setExamples] = useState<ExampleEntry[]>([]);
  const [editingExample, setEditingExample] = useState<number | null>(null);
  const [draftExample, setDraftExample] = useState<ExampleEntry>({ input: "", output: "" });
  const [newExample, setNewExample] = useState<ExampleEntry | null>(null);

  const applyParsedManifest = useCallback((yaml: string) => {
    try {
      const parsed = parseYAML(yaml);
      if (!isRecord(parsed)) return;

      setAgentId(typeof parsed.id === "string" ? parsed.id : "");
      setAgentName(typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "New Agent");
      setInstruction(typeof parsed.instruction === "string" ? parsed.instruction : "");
      setSupportsInstruction(parsed.kind === "llm");

      if (Array.isArray(parsed.examples)) {
        setExamples(
          parsed.examples
            .filter(isRecord)
            .map((entry) => ({
              input: typeof entry.input === "string" ? entry.input : "",
              output: typeof entry.output === "string" ? entry.output : "",
            }))
        );
      } else {
        setExamples([]);
      }

      if (parsed.kind !== "llm") {
        setEditorMode("yaml");
      }
    } catch {
      // Ignore partial drafts while the YAML is being edited.
    }
  }, []);

  const validateManifest = useCallback(async (yaml: string) => {
    if (!yaml.trim()) {
      setErrors([]);
      setWarnings([]);
      return;
    }

    try {
      const res = await fetch("/api/agents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: yaml }),
      });

      const result = await res.json();
      setErrors(result.errors ?? []);
      setWarnings(result.warnings ?? []);
    } catch {
      // Ignore validation failures while editing.
    }
  }, []);

  useEffect(() => {
    if (!manifest) return;
    const timeout = setTimeout(() => {
      validateManifest(manifest);
    }, 400);

    return () => clearTimeout(timeout);
  }, [manifest, validateManifest]);

  const updateExamplesInManifest = (nextExamples: ExampleEntry[]) => {
    setExamples(nextExamples);
    setStatus(null);

    try {
      const parsed = parseYAML(manifest);
      if (!isRecord(parsed)) return;

      if (nextExamples.length > 0) {
        parsed.examples = nextExamples;
      } else {
        delete parsed.examples;
      }

      setManifest(stringifyYAML(parsed, { lineWidth: 0 }));
    } catch {
      // Ignore invalid YAML.
    }
  };

  const handleGenerate = async () => {
    if (!aiPrompt.trim()) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/agents/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiPrompt }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? "Failed to generate agent");
        return;
      }

      if (typeof data.yaml === "string") {
        setManifest(data.yaml);
        applyParsedManifest(data.yaml);
        setStatus("Draft generated from AI prompt");
      }
    } catch (error) {
      setAiError(String(error));
    } finally {
      setAiLoading(false);
    }
  };

  const handleUseStarter = () => {
    setManifest(DEFAULT_MANIFEST);
    applyParsedManifest(DEFAULT_MANIFEST);
    setStatus("Starter manifest loaded");
  };

  const handleInstructionChange = (value: string) => {
    setInstruction(value);
    setStatus(null);

    try {
      const parsed = parseYAML(manifest);
      if (!isRecord(parsed)) return;
      parsed.instruction = value;
      setManifest(stringifyYAML(parsed, { lineWidth: 0 }));
    } catch {
      // Ignore invalid YAML while editing instruction text.
    }
  };

  const handleEditExample = (index: number) => {
    setEditingExample(index);
    setDraftExample(examples[index]);
  };

  const handleSaveExample = () => {
    if (editingExample === null) return;
    const next = [...examples];
    next[editingExample] = draftExample;
    updateExamplesInManifest(next);
    setEditingExample(null);
  };

  const handleAddExample = () => {
    if (!newExample || !newExample.input.trim() || !newExample.output.trim()) return;
    updateExamplesInManifest([...examples, newExample]);
    setNewExample(null);
  };

  const handleCreate = async () => {
    const structuralErrors = errors.filter((error) => error.level === "structural");
    if (!agentId.trim() || !manifest.trim() || structuralErrors.length > 0) {
      setStatus("Fix validation errors before creating the agent");
      return;
    }

    setCreating(true);
    setStatus(null);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agentId.trim(),
          name: agentName === "New Agent" ? agentId.trim() : agentName,
          manifest,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setStatus(`Error: ${data.error ?? "Failed to create agent"}`);
        return;
      }

      router.push(`/agents/${agentId.trim()}`);
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    } finally {
      setCreating(false);
    }
  };

  const hasErrors = errors.length > 0;
  const currentMode = supportsInstruction ? editorMode : "yaml";

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Agents", href: "/agents" }, { label: "New Agent" }]} />

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Create Agent</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            Start with an AI description or a starter manifest, then refine the YAML, instruction text, and examples before creating the agent.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {status && (
            <span
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                status.startsWith("Error") || status.startsWith("Fix")
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {status}
            </span>
          )}
          <button
            onClick={handleCreate}
            disabled={creating || hasErrors || !manifest.trim() || !agentId.trim()}
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {creating ? "Creating…" : "Create agent"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Make Edits</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Describe the agent you want, then generate a first draft. If you prefer, start from the default template instead.
            </p>
          </div>

          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="An agent that classifies support tickets by urgency, summarizes the request, and proposes a follow-up..."
            className="h-32 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleGenerate}
                disabled={aiLoading || !aiPrompt.trim()}
                className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {aiLoading ? "Generating…" : "Generate draft"}
              </button>
              <button
                onClick={handleUseStarter}
                className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-stone-300 hover:bg-stone-50"
              >
                Use starter manifest
              </button>
            </div>

            {aiError && <p className="text-sm text-red-600">{aiError}</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Status</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill label="Validation" value={hasErrors ? "Errors" : warnings.length > 0 ? "Warnings" : "Ready"} tone={hasErrors ? "danger" : warnings.length > 0 ? "warning" : "success"} />
              <StatusPill label="Panels" value={supportsInstruction ? currentMode : "yaml"} />
              <StatusPill label="Examples" value={String(examples.length)} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              {manifest ? (
                <ValidationBanner errors={errors} warnings={warnings} />
              ) : (
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-500">
                  Generate or load a starter manifest to begin editing.
                </div>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Agent ID</span>
              <input
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                placeholder="my-agent-id"
                className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-400 focus:bg-white"
              />
            </label>
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Agent Definition</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Edit the manifest directly, or use the instruction panel when the draft is an LLM agent.
              </p>
            </div>
            {supportsInstruction ? (
              <PanelToggle value={currentMode} onChange={(mode) => setEditorMode(mode)} />
            ) : (
              <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-zinc-500">
                Instruction panel is available for `kind: llm` agents only
              </span>
            )}
          </div>

          <div className={currentMode === "both" ? "grid gap-4 xl:grid-cols-2" : "grid gap-4"}>
            {(currentMode === "yaml" || currentMode === "both") && (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">YAML</div>
                <textarea
                  value={manifest}
                  onChange={(event) => {
                    setManifest(event.target.value);
                    applyParsedManifest(event.target.value);
                    setStatus(null);
                  }}
                  spellCheck={false}
                  className={`h-[32rem] w-full rounded-2xl border bg-white px-4 py-3 font-mono text-sm outline-none transition ${
                    hasErrors
                      ? "border-red-300 focus:border-red-400"
                      : warnings.length > 0
                        ? "border-amber-300 focus:border-amber-400"
                        : "border-stone-200 focus:border-zinc-400"
                  }`}
                />
              </div>
            )}

            {(currentMode === "instruction" || currentMode === "both") && supportsInstruction && (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Instruction Template
                </div>
                <textarea
                  value={instruction}
                  onChange={(event) => handleInstructionChange(event.target.value)}
                  spellCheck={false}
                  className="h-[32rem] w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-zinc-400"
                />
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Examples</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Add example conversations or structured input/output pairs before saving the agent.
              </p>
            </div>
            <button
              onClick={() => setNewExample({ input: "", output: "" })}
              className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-stone-300 hover:bg-stone-50"
            >
              Add example
            </button>
          </div>

          <div className="space-y-3">
            {examples.length === 0 && !newExample && (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
                No examples yet.
              </div>
            )}

            {examples.map((example, index) => (
              <div key={`${example.input}-${index}`} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-zinc-900">Example {index + 1}</div>
                  <div className="flex gap-2">
                    {editingExample === index ? (
                      <>
                        <button
                          onClick={handleSaveExample}
                          className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingExample(null)}
                          className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-white"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleEditExample(index)}
                          className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => updateExamplesInManifest(examples.filter((_, currentIndex) => currentIndex !== index))}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {editingExample === index ? (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ExampleEditor
                      label="Input"
                      value={draftExample.input}
                      onChange={(value) => setDraftExample((current) => ({ ...current, input: value }))}
                    />
                    <ExampleEditor
                      label="Output"
                      value={draftExample.output}
                      onChange={(value) => setDraftExample((current) => ({ ...current, output: value }))}
                    />
                  </div>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <ExamplePreview label="Input" value={example.input} />
                    <ExamplePreview label="Output" value={example.output} />
                  </div>
                )}
              </div>
            ))}

            {newExample && (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 text-sm font-medium text-zinc-900">New example</div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <ExampleEditor
                    label="Input"
                    value={newExample.input}
                    onChange={(value) => setNewExample((current) => (current ? { ...current, input: value } : current))}
                  />
                  <ExampleEditor
                    label="Output"
                    value={newExample.output}
                    onChange={(value) => setNewExample((current) => (current ? { ...current, output: value } : current))}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleAddExample}
                    disabled={!newExample.input.trim() || !newExample.output.trim()}
                    className="rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    Add example
                  </button>
                  <button
                    onClick={() => setNewExample(null)}
                    className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Versions</h2>
          <p className="mt-3 text-sm text-zinc-600">
            Version history appears after the agent is created. Each save on the edit page adds a new version to the top of the list.
          </p>
        </section>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClasses = {
    neutral: "bg-stone-100 text-zinc-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-700",
  };

  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-medium ${toneClasses[tone]}`}>
      {label}: {value}
    </span>
  );
}

function ExampleEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-32 w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-zinc-400"
      />
    </label>
  );
}

function ExamplePreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-zinc-700">{value}</pre>
    </div>
  );
}
