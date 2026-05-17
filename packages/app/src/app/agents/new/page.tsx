"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { CreateLanding } from "@/components/v3/create/landing";
import { CreateGenerating, type GenerateStep } from "@/components/v3/create/generating";
import { EditorShell } from "@/components/v3/editor/editor-shell";
import {
  SingleAgentView,
  type SingleAgentManifest,
  type SingleViewMode,
} from "@/components/v3/editor/single-agent-view";
import { PipelineView, type PipelineViewMode } from "@/components/v3/editor/pipeline-view";
import { YamlEditor } from "@/components/yaml-editor";
import { useCatalog } from "@/lib/use-catalog";
import { ag, Mono, Tag } from "@/components/v3/primitives";
import { I } from "@/components/v3/icons";

type Phase = "landing" | "generating" | "editor";

const BLANK_LLM = `id: my-agent
name: My Agent
kind: llm

model:
  provider: openai
  name: gpt-5.4

instruction: |
  You are a helpful assistant.
`;

const STARTER_TEMPLATES: Record<string, string> = {
  "blank-llm": BLANK_LLM,
  rag: `id: rag-agent
name: RAG over docs
kind: llm

model:
  provider: openai
  name: gpt-5.4

inputSchema:
  question: string

instruction: |
  Answer the user's question using the provided context.

  Question: {{question}}
`,
  "tool-calling": `id: tool-agent
name: Tool-calling agent
kind: llm

model:
  provider: openai
  name: gpt-5.4

instruction: |
  You are a helpful assistant with access to tools.
`,
  "multi-agent": `id: multi-agent
name: Multi-agent pipeline
kind: sequential

inputSchema:
  topic: string

steps:
  - agent:
      id: planner
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: |
        Plan the work for {{topic}}.

  - agent:
      id: executor
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: |
        Execute the plan: {{planner.output}}
`,
};

const SIM_STEPS: GenerateStep[] = [
  { label: "Parsed description", sub: "extracting purpose, inputs, output" },
  { label: "Choosing agent kind", sub: "single LLM vs pipeline" },
  { label: "Drafting manifest", sub: "model, instruction, schema" },
  { label: "Wiring tools and examples", sub: "if applicable" },
  { label: "Validating draft", sub: "running schema checks" },
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export default function NewAgentPage() {
  const router = useRouter();
  const catalog = useCatalog();

  const [phase, setPhase] = useState<Phase>("landing");
  const [prompt, setPrompt] = useState("");
  const [manifest, setManifest] = useState("");
  const [view, setView] = useState<SingleViewMode | PipelineViewMode>("build");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Generating-screen state
  const [genSteps, setGenSteps] = useState<GenerateStep[]>(SIM_STEPS.map((s) => ({ ...s })));
  const [genElapsed, setGenElapsed] = useState(0);
  const startedAtRef = useRef<number>(0);
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const parsed = useMemo(() => {
    if (!manifest.trim()) return null;
    try {
      const value = parseYAML(manifest);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }, [manifest]);

  const isPipeline = parsed?.kind === "sequential" || parsed?.kind === "parallel";
  const manifestId = typeof parsed?.id === "string" ? parsed.id : "";
  const manifestName = typeof parsed?.name === "string" ? parsed.name : manifestId || "New Agent";

  const stopGenerationTimers = useCallback(() => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    simIntervalRef.current = undefined;
  }, []);

  useEffect(() => stopGenerationTimers, [stopGenerationTimers]);

  const startSimulation = useCallback(() => {
    startedAtRef.current = Date.now();
    setGenElapsed(0);
    setGenSteps(SIM_STEPS.map((s, i) => ({ ...s, active: i === 0 })));
    simIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setGenElapsed(elapsed);
      // Auto-advance the active step every ~1.2s so the user sees life
      // even before the API response lands.
      setGenSteps((current) => {
        const activeIdx = current.findIndex((s) => s.active);
        if (activeIdx < 0) return current;
        if (elapsed > (activeIdx + 1) * 1.2 && activeIdx < current.length - 1) {
          const next = current.map((s, i) => ({
            ...s,
            done: i <= activeIdx,
            active: i === activeIdx + 1,
          }));
          return next;
        }
        return current;
      });
    }, 200);
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setManifest("");
    setPhase("generating");
    startSimulation();

    try {
      const res = await fetch("/api/agents/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        stopGenerationTimers();
        setError(data.error ?? "Generation failed");
        setPhase("landing");
        return;
      }
      if (typeof data.yaml !== "string") {
        stopGenerationTimers();
        setError("No manifest returned from the builder");
        setPhase("landing");
        return;
      }
      // Finalize all sim steps then hand off to editor.
      setGenSteps((current) =>
        current.map((s) => ({ ...s, done: true, active: false }))
      );
      stopGenerationTimers();
      setManifest(data.yaml);
      setPhase("editor");
    } catch (err) {
      stopGenerationTimers();
      setError(String(err));
      setPhase("landing");
    }
  };

  const handleBuildManually = () => {
    setManifest(BLANK_LLM);
    setPhase("editor");
  };

  const handlePickTemplate = (key: string) => {
    setManifest(STARTER_TEMPLATES[key] ?? BLANK_LLM);
    setPhase("editor");
  };

  const handleCancelGenerating = () => {
    stopGenerationTimers();
    setPhase("landing");
  };

  const handleManifestChange = useCallback((next: Record<string, unknown>) => {
    try {
      setManifest(stringifyYAML(next, { lineWidth: 0 }));
    } catch {
      // Ignore; the YAML pane is the canonical source if this fails.
    }
  }, []);

  const handleCreate = async () => {
    if (!parsed || !manifestId.trim()) {
      setError("Manifest needs an id before saving.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: manifestId, name: manifestName, manifest }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create agent");
        return;
      }
      router.push(`/agents/${manifestId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  if (phase === "landing") {
    return (
      <CreateLanding
        prompt={prompt}
        onChangePrompt={setPrompt}
        onGenerate={handleGenerate}
        onBuildManually={handleBuildManually}
        onPickTemplate={handlePickTemplate}
        onCancel={() => router.push("/agents")}
        error={error}
      />
    );
  }

  if (phase === "generating") {
    return (
      <CreateGenerating
        description={prompt}
        onStop={handleCancelGenerating}
        steps={genSteps}
        elapsedSeconds={genElapsed}
      />
    );
  }

  // phase === "editor"
  return (
    <EditorShell
      breadcrumb={["agntz", "Agents", manifestName]}
      title={manifestName}
      manifestId={manifestId || "—"}
      kindTag={
        <Tag bg={isPipeline ? ag.purpleBg : ag.blueBg} color={isPipeline ? ag.purple : ag.blue} mono>
          {isPipeline ? (typeof parsed?.kind === "string" ? parsed.kind : "Pipeline") : "LLM"}
        </Tag>
      }
      statusTag={
        <Tag bg={ag.warnBg} color={ag.warn}>
          <I.Dot size={6} color={ag.warn} />
          Draft
        </Tag>
      }
      metaRight={
        <Mono size={11} color={ag.muted}>
          unsaved
        </Mono>
      }
      onSave={handleCreate}
      saving={creating}
      saveLabel="Create agent"
    >
      {error && <ErrorStrip>{error}</ErrorStrip>}
      {isPipeline ? (
        <PipelineView
          rootManifest={parsed!}
          manifestId={manifestId || "new"}
          view={view as PipelineViewMode}
          onChangeView={(v) => setView(v)}
          onChange={handleManifestChange}
          yamlPanel={
            <YamlPanel
              manifest={manifest}
              setManifest={setManifest}
              catalog={catalog}
            />
          }
        />
      ) : (
        <SingleAgentView
          manifest={(parsed ?? {}) as SingleAgentManifest}
          manifestId={manifestId || "new"}
          view={view as SingleViewMode}
          onChangeView={(v) => setView(v)}
          onChange={(next) => handleManifestChange(next as Record<string, unknown>)}
          catalog={catalog}
          yamlPanel={
            <YamlPanel
              manifest={manifest}
              setManifest={setManifest}
              catalog={catalog}
            />
          }
        />
      )}
    </EditorShell>
  );
}

function ErrorStrip({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 28px",
        background: "#FBEFEA",
        borderBottom: `1px solid ${ag.line2}`,
        color: ag.danger,
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <I.X size={11} />
      {children}
    </div>
  );
}

function YamlPanel({
  manifest,
  setManifest,
  catalog,
}: {
  manifest: string;
  setManifest: (v: string) => void;
  catalog: ReturnType<typeof useCatalog>;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: ag.surface,
        borderRight: `1px solid ${ag.line2}`,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: ag.muted,
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        Manifest
      </div>
      <YamlEditor value={manifest} onChange={setManifest} catalog={catalog} />
    </div>
  );
}
