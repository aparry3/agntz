"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { Breadcrumb } from "@/components/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
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

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface VersionEntry {
  createdAt: string;
  activatedAt: string | null;
}

interface ExampleEntry {
  input: string;
  output: string;
}

type EditorMode = "yaml" | "instruction" | "both";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sortVersions(versions: VersionEntry[]) {
  return [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function AgentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [manifest, setManifest] = useState("");
  const [instruction, setInstruction] = useState("");
  const [agentName, setAgentName] = useState(id);
  const [supportsInstruction, setSupportsInstruction] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [editorMode, setEditorMode] = useState<EditorMode>("both");

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [examples, setExamples] = useState<ExampleEntry[]>([]);
  const [editingExample, setEditingExample] = useState<number | null>(null);
  const [draftExample, setDraftExample] = useState<ExampleEntry>({ input: "", output: "" });
  const [newExample, setNewExample] = useState<ExampleEntry | null>(null);

  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const applyParsedManifest = useCallback(
    (yaml: string) => {
      try {
        const parsed = parseYAML(yaml);
        if (!isRecord(parsed)) return;

        setAgentName(typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : id);
        setInstruction(typeof parsed.instruction === "string" ? parsed.instruction : "");
        setSupportsInstruction(parsed.kind === "llm");

        if (Array.isArray(parsed.examples)) {
          const nextExamples = parsed.examples
            .filter(isRecord)
            .map((entry) => ({
              input: typeof entry.input === "string" ? entry.input : "",
              output: typeof entry.output === "string" ? entry.output : "",
            }));
          setExamples(nextExamples);
        } else {
          setExamples([]);
        }

        if (parsed.kind !== "llm") {
          setEditorMode("yaml");
        }
      } catch {
        // Keep the current derived state if the draft YAML is temporarily invalid.
      }
    },
    [id]
  );

  const validateDebounced = useCallback((yaml: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!yaml.trim()) {
        setValidation(null);
        return;
      }

      setValidating(true);
      try {
        const res = await fetch("/api/agents/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: yaml }),
        });
        const result = await res.json();
        setValidation(result);
      } catch {
        // Ignore validation failures.
      } finally {
        setValidating(false);
      }
    }, 400);
  }, []);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/agents/${id}/versions`);
      const data = await res.json();
      setVersions(sortVersions(data));
    } catch {
      // Ignore version load failures.
    } finally {
      setVersionsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch(`/api/agents/${id}`)
      .then((r) => r.json())
      .then((agent) => {
        const manifestYaml = agent.metadata?.manifest ?? "";
        setManifest(manifestYaml);
        applyParsedManifest(manifestYaml);
        validateDebounced(manifestYaml);
      })
      .finally(() => setLoading(false));

    loadVersions();
  }, [applyParsedManifest, id, loadVersions, validateDebounced]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const updateManifest = (nextManifest: string, source?: "yaml" | "instruction") => {
    setManifest(nextManifest);
    setStatus(null);
    validateDebounced(nextManifest);

    if (source === "yaml") {
      applyParsedManifest(nextManifest);
    }
  };

  const handleInstructionChange = (value: string) => {
    setInstruction(value);
    setStatus(null);

    try {
      const parsed = parseYAML(manifest);
      if (!isRecord(parsed)) return;
      parsed.instruction = value;
      const updated = stringifyYAML(parsed, { lineWidth: 0 });
      setManifest(updated);
      validateDebounced(updated);
    } catch {
      // Ignore invalid YAML while the instruction panel is being edited.
    }
  };

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

      const updated = stringifyYAML(parsed, { lineWidth: 0 });
      setManifest(updated);
      validateDebounced(updated);
    } catch {
      // Leave the YAML alone if it is not currently parseable.
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

  const handleDeleteExample = (index: number) => {
    updateExamplesInManifest(examples.filter((_, currentIndex) => currentIndex !== index));
    if (editingExample === index) {
      setEditingExample(null);
    }
  };

  const handleSave = async () => {
    if (validation && !validation.valid) {
      setStatus("Fix validation errors before saving");
      return;
    }

    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest }),
      });

      if (!res.ok) {
        const body = await res.json();
        setStatus(`Error: ${body.error ?? "Failed to save agent"}`);
        return;
      }

      const body = await res.json();
      const warningCount = body.warnings?.length ?? 0;
      setStatus(warningCount > 0 ? `Saved with ${warningCount} warning${warningCount === 1 ? "" : "s"}` : "Saved");
      await loadVersions();
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    router.push("/agents");
  };

  const handleAiApply = async () => {
    if (!aiPrompt.trim()) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/agents/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: aiPrompt,
          currentManifest: manifest || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error ?? "Failed to generate");
        return;
      }

      if (typeof data.yaml === "string") {
        setManifest(data.yaml);
        applyParsedManifest(data.yaml);
        validateDebounced(data.yaml);
        setAiPrompt("");
        setStatus("Draft updated from AI prompt");
      }
    } catch (error) {
      setAiError(String(error));
    } finally {
      setAiLoading(false);
    }
  };

  const handleLoadVersion = async (createdAt: string) => {
    try {
      const res = await fetch(`/api/agents/${id}/versions/${encodeURIComponent(createdAt)}`);
      const agent = await res.json();
      if (typeof agent?.metadata?.manifest !== "string") return;

      setManifest(agent.metadata.manifest);
      applyParsedManifest(agent.metadata.manifest);
      validateDebounced(agent.metadata.manifest);
      setStatus(`Loaded version from ${new Date(createdAt).toLocaleString()}`);
    } catch {
      setStatus("Error: failed to load version");
    }
  };

  const handleActivateVersion = async (createdAt: string) => {
    try {
      await fetch(`/api/agents/${id}/versions/${encodeURIComponent(createdAt)}/activate`, {
        method: "POST",
      });
      setStatus("Version activated");
      await loadVersions();
    } catch {
      setStatus("Error: failed to activate version");
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString();
  };

  const relativeTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;

    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-zinc-500">Loading agent…</p>
      </div>
    );
  }

  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const currentMode = supportsInstruction ? editorMode : "yaml";

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumb items={[{ label: "Agents", href: "/agents" }, { label: agentName }]} />

      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">{agentName}</h1>
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 font-mono text-xs text-zinc-500">
              {id}
            </span>
            <CopyButton text={id} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <Link
              href={`/agents/${id}/playground`}
              className="rounded-full border border-stone-200 bg-white px-3 py-1.5 font-medium text-zinc-700 transition hover:border-stone-300 hover:text-zinc-950"
            >
              Open playground
            </Link>
            <span>{supportsInstruction ? "LLM agent" : "YAML-only agent"}</span>
            {validating && <span>Validating draft…</span>}
          </div>
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
            onClick={handleSave}
            disabled={saving || hasErrors}
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Make Edits</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Describe the agent you want to create or the changes you want applied to this draft.
              </p>
            </div>
          </div>

          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="Describe the behavior, tools, examples, or prompt changes you want..."
            className="h-32 w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {aiError ? <p className="text-sm text-red-600">{aiError}</p> : <div />}
            <button
              onClick={handleAiApply}
              disabled={aiLoading || !aiPrompt.trim()}
              className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {aiLoading ? "Applying…" : "Apply AI changes"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Status</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill label="Validation" value={hasErrors ? "Errors" : hasWarnings ? "Warnings" : "Ready"} tone={hasErrors ? "danger" : hasWarnings ? "warning" : "success"} />
              <StatusPill label="Panels" value={supportsInstruction ? currentMode : "yaml"} />
              <StatusPill label="Examples" value={String(examples.length)} />
              <StatusPill label="Versions" value={versionsLoading ? "Loading" : String(versions.length)} />
            </div>
          </div>

          {validation ? (
            <ValidationBanner errors={errors} warnings={warnings} />
          ) : (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-zinc-500">
              Validation results will appear here as you edit the manifest.
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Agent Definition</h2>
              <p className="mt-2 text-sm text-zinc-600">
                Edit raw YAML directly, use the instruction editor for LLM agents, or keep both open side by side.
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
                  onChange={(event) => updateManifest(event.target.value, "yaml")}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                      event.preventDefault();
                      handleSave();
                    }
                  }}
                  spellCheck={false}
                  className={`h-[32rem] w-full rounded-2xl border bg-white px-4 py-3 font-mono text-sm outline-none transition ${
                    hasErrors
                      ? "border-red-300 focus:border-red-400"
                      : hasWarnings
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
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                      event.preventDefault();
                      handleSave();
                    }
                  }}
                  spellCheck={false}
                  className="h-[32rem] w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-zinc-400"
                  placeholder="Write the instruction template here..."
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
                Add input/output pairs that document expected behavior and stay synced with the manifest.
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
                          onClick={() => handleDeleteExample(index)}
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
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Versions</h2>
            <p className="mt-2 text-sm text-zinc-600">
              Selecting a version loads that manifest into the page. Saving creates a fresh version at the top of the list.
            </p>
          </div>

          <div className="space-y-2">
            {versionsLoading ? (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
                Loading versions…
              </div>
            ) : versions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
                No versions yet. Save this agent to create the first one.
              </div>
            ) : (
              versions.map((version, index) => {
                const isActive = index === 0 || version.activatedAt !== null;
                const versionKey = `${id}@${version.createdAt}`;

                return (
                  <div
                    key={version.createdAt}
                    className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                      isActive ? "border-zinc-900 bg-zinc-950 text-white" : "border-stone-200 bg-stone-50"
                    }`}
                  >
                    <button
                      onClick={() => handleLoadVersion(version.createdAt)}
                      className="flex flex-1 flex-col items-start text-left"
                    >
                      <span className={`text-sm font-medium ${isActive ? "text-white" : "text-zinc-900"}`}>
                        {relativeTimestamp(version.createdAt)}
                      </span>
                      <span className={`mt-1 font-mono text-xs ${isActive ? "text-zinc-300" : "text-zinc-500"}`}>
                        {formatTimestamp(version.createdAt)}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isActive && (
                        <span className="rounded-full bg-white/12 px-2.5 py-1 text-xs font-medium text-white">
                          Active
                        </span>
                      )}
                      <CopyButton text={versionKey} />
                      {!version.activatedAt && (
                        <button
                          onClick={() => handleActivateVersion(version.createdAt)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                            isActive
                              ? "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                              : "border border-stone-200 bg-white text-zinc-700 hover:bg-stone-100"
                          }`}
                        >
                          Activate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showDelete}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agentName}"? All versions will be permanently removed.`}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
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
