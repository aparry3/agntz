// SingleAgentView — V3 editor layout for a kind=llm manifest. Composes the
// header, view switcher, graph panel, and a manifest-bound inspector.
//
// Reads a parsed manifest (yaml -> JS object) and a couple of callbacks so
// the parent owns the YAML string. The inspector edits push back through
// `onPatch(field, value)` which the parent re-stringifies into YAML.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { I } from "@/components/v3/icons";
import {
  Btn,
  Mono,
  Spinner,
  Tag,
  VarHl,
  ag,
} from "@/components/v3/primitives";
import { GraphPanel, GraphValidates } from "./graph-panel";
import { NodeIO, Edge } from "@/components/v3/primitives";
import { PipelineStep, type StepField } from "./pipeline-step";
import {
  BindRow,
  DashedAdd,
  Field,
  FooterHint,
  InsSection,
  StateLine,
  SubBlock,
  ToolBlock,
  ToolRow,
} from "./inspector-bits";

export type SingleViewMode = "build" | "yaml" | "instruction" | "both";

export interface SingleAgentManifest {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
  model?: { provider?: string; name?: string; temperature?: number; maxTokens?: number };
  instruction?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: Array<{ input: string; output: string }>;
  tools?: Array<Record<string, unknown>>;
}

export function SingleAgentView({
  manifest,
  manifestId,
  view,
  onChangeView,
  onChange,
  rightExtras,
  yamlPanel,
}: {
  manifest: SingleAgentManifest;
  manifestId: string;
  view: SingleViewMode;
  onChangeView: (v: SingleViewMode) => void;
  /** Generic patcher — receives a fully-formed next manifest. Phase 2+ editors
   *  call this to commit changes; the parent re-serializes to YAML. */
  onChange?: (next: SingleAgentManifest) => void;
  rightExtras?: ReactNode;
  yamlPanel?: ReactNode;
}) {
  const inputs = parseInputSchema(manifest.inputSchema);
  const outputs = parseSchema(manifest.outputSchema);
  const modelLine = formatModel(manifest.model);
  const counts = `${inputs.length} input${inputs.length === 1 ? "" : "s"} · ${outputs.length} output${
    outputs.length === 1 ? "" : "s"
  } · ${manifest.examples?.length ?? 0} example${manifest.examples?.length === 1 ? "" : "s"}`;

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* View switcher */}
      <div
        style={{
          padding: "10px 28px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.surface,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: ag.muted,
            fontWeight: 500,
          }}
        >
          View
        </div>
        <div
          style={{
            display: "flex",
            padding: 2,
            background: ag.surface2,
            border: `1px solid ${ag.line}`,
            borderRadius: 4,
          }}
        >
          {(
            [
              ["Build", I.Sliders, "build"],
              ["YAML", I.Code, "yaml"],
              ["Instruction", I.Sparkle, "instruction"],
              ["Both", I.Eye, "both"],
            ] as const
          ).map(([t, Ic, key]) => (
            <button
              key={key}
              onClick={() => onChangeView(key as SingleViewMode)}
              style={{
                padding: "5px 11px",
                borderRadius: 3,
                fontSize: 12,
                background: view === key ? ag.bg : "transparent",
                color: view === key ? ag.ink : ag.text2,
                border: "none",
                cursor: "pointer",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "inherit",
              }}
            >
              <Ic size={11} />
              {t}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <Mono size={11} color={ag.muted}>
          {counts}
        </Mono>
        {rightExtras}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: view === "yaml" ? "1fr" : view === "both" ? "1fr 1fr 420px" : "1fr 420px", minHeight: 0 }}>
        {(view === "build" || view === "both" || view === "instruction") && (
          <GraphPanel
            topRight={
              <Btn
                variant="secondary"
                size="sm"
                icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
              >
                Convert to pipeline
              </Btn>
            }
            status={
              <>
                <GraphValidates />
                <Mono size={11}>1 LLM call · est. 1.4s · ~$0.002/run</Mono>
              </>
            }
          >
            <NodeIO label="INPUT" sub={inputs.map((i) => i.name).join(" · ") || "—"} />
            <Edge />
            <PipelineStep
              id={manifestId}
              name={manifest.name ?? manifestId}
              kind="llm"
              selected
              summary={manifest.description}
              model={modelLine}
              inputs={inputs}
              outputs={outputs}
            />
            <Edge />
            <NodeIO label="OUTPUT" sub={outputs.map((o) => o.name).join(" · ") || "—"} />
          </GraphPanel>
        )}

        {(view === "yaml" || view === "both") && yamlPanel}

        {view !== "yaml" && (
          <SingleAgentInspector
            manifest={manifest}
            manifestId={manifestId}
            inputs={inputs}
            outputs={outputs}
            modelLine={modelLine}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
}

function SingleAgentInspector({
  manifest,
  manifestId,
  inputs,
  outputs,
  modelLine,
  onChange,
}: {
  manifest: SingleAgentManifest;
  manifestId: string;
  inputs: StepField[];
  outputs: StepField[];
  modelLine: string;
  onChange?: (next: SingleAgentManifest) => void;
}) {
  const handleInstruction = onChange
    ? (next: string) => onChange({ ...manifest, instruction: next })
    : undefined;
  return (
    <aside
      style={{
        background: ag.surface,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderLeft: `1px solid ${ag.line2}`,
      }}
    >
      {/* Compact header */}
      <div
        style={{
          padding: "11px 16px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.surface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <Mono size={10.5} color={ag.muted}>
            root agent
          </Mono>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag bg={ag.blueBg} color={ag.blue} mono>
            LLM
          </Tag>
          <div style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>{manifest.name ?? manifestId}</div>
          <Mono size={10.5} color={ag.muted}>
            {manifestId}
          </Mono>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Inputs */}
        <div style={{ padding: "16px 16px 8px" }}>
          <div style={{ marginBottom: 4 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: ag.ink,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Inputs
            </div>
            <div style={{ fontSize: 11.5, color: ag.muted, marginTop: 4 }}>
              The agent&apos;s declared inputs and where each one&apos;s value is bound from.
            </div>
          </div>
          <div
            style={{
              marginTop: 10,
              border: `1px solid ${ag.line}`,
              borderRadius: 4,
              background: ag.surface2,
              overflow: "hidden",
            }}
          >
            {inputs.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11.5, color: ag.muted, textAlign: "center" }}>
                No inputs declared.
              </div>
            ) : (
              inputs.map((f, i) => (
                <BindRow
                  key={f.name}
                  target={f.name}
                  type={f.type}
                  required={f.required}
                  binding={inferBinding(f.name)}
                  last={i === inputs.length - 1}
                />
              ))
            )}
          </div>
          <DashedAdd>+ Add input</DashedAdd>
        </div>

        {/* Available state */}
        <div style={{ padding: "8px 16px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: ag.ink,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Available state
            </div>
            <Mono size={10} color={ag.muted}>
              click to insert →
            </Mono>
          </div>
          <div
            style={{
              border: `1px solid ${ag.line2}`,
              borderRadius: 4,
              background: ag.bg,
              overflow: "hidden",
            }}
          >
            {inputs.length === 0 ? (
              <div style={{ padding: 8, fontSize: 11, color: ag.muted, textAlign: "center" }}>
                Declare an input above to make it available in templates.
              </div>
            ) : (
              inputs.map((f, i) => (
                <StateLine
                  key={f.name}
                  name={f.name}
                  type={f.type}
                  origin="input"
                  last={i === inputs.length - 1}
                />
              ))
            )}
          </div>
        </div>

        {/* Agent settings */}
        <div style={{ borderTop: `1px solid ${ag.line2}` }}>
          <InsSection title="Agent settings" badge="model · instruction" defaultOpen>
            {manifest.description && (
              <SubBlock label="Description" value={manifest.description} multiline />
            )}
            <SubBlock label="Model" value={modelLine || "—"} mono select />
            <InstructionBlock instruction={manifest.instruction ?? ""} onChange={handleInstruction} />
          </InsSection>

          <InsSection title="Tools" badge={`${manifest.tools?.length ?? 0} attached`}>
            <ToolBlock kind="local" label="local">
              <ToolRow name="No tools wired yet" sub="Add a tool source via the YAML view" />
            </ToolBlock>
            <DashedAdd>+ Add tool source</DashedAdd>
          </InsSection>

          <InsSection title="Output schema" badge={`${outputs.length} field${outputs.length === 1 ? "" : "s"}`}>
            {outputs.length === 0 ? (
              <Mono size={11} color={ag.muted}>
                No output schema declared.
              </Mono>
            ) : (
              outputs.map((o) => <SubBlock key={o.name} label={o.name} value={o.type} mono />)
            )}
          </InsSection>

          <InsSection
            title="Examples"
            badge={`${manifest.examples?.length ?? 0} pinned`}
          >
            {manifest.examples?.length ? (
              manifest.examples.slice(0, 3).map((ex, i) => (
                <SubBlock
                  key={i}
                  label={`#${i + 1}`}
                  value={ex.input.slice(0, 80) + (ex.input.length > 80 ? "…" : "")}
                  mono
                />
              ))
            ) : (
              <Mono size={11} color={ag.muted}>
                No examples yet.
              </Mono>
            )}
          </InsSection>

          <InsSection title="Advanced">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field inline label="Run timeout" value="30s" mono />
              <Field inline label="Visibility" value="workspace" mono select />
            </div>
          </InsSection>
        </div>
      </div>

      <FooterHint>
        Templates &amp; tool params can only reference the {inputs.length}{" "}
        input{inputs.length === 1 ? "" : "s"} above.
      </FooterHint>
    </aside>
  );
}

function InstructionBlock({
  instruction,
  onChange,
}: {
  instruction: string;
  onChange?: (next: string) => void;
}) {
  return (
    <div>
      <Mono
        size={10}
        color={ag.muted}
        style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
      >
        Instruction
      </Mono>
      {onChange ? (
        <textarea
          value={instruction}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          style={{
            display: "block",
            width: "100%",
            marginTop: 5,
            border: `1px solid ${ag.line}`,
            borderRadius: 4,
            padding: "8px 10px",
            background: ag.surface2,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.6,
            color: ag.ink,
            resize: "vertical",
            minHeight: 140,
            outline: "none",
          }}
        />
      ) : (
        <div
          style={{
            marginTop: 5,
            border: `1px solid ${ag.line}`,
            borderRadius: 4,
            padding: "8px 10px",
            background: ag.surface2,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.6,
            color: ag.ink,
            whiteSpace: "pre-wrap",
            maxHeight: 180,
            overflow: "auto",
          }}
        >
          <HighlightInstruction text={instruction} />
        </div>
      )}
    </div>
  );
}

function HighlightInstruction({ text }: { text: string }) {
  if (!text) return <span style={{ color: ag.muted }}>(no instruction)</span>;
  const parts: ReactNode[] = [];
  const regex = /(\{\{[^}]+\}\})/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push(<VarHl key={`v-${key++}`}>{m[0]}</VarHl>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function parseInputSchema(schema: Record<string, unknown> | undefined): StepField[] {
  if (!schema) return [];
  return Object.entries(schema).map(([name, def]) => {
    if (typeof def === "string") return { name, type: def, required: true };
    if (def && typeof def === "object") {
      const obj = def as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "string";
      const required = obj.default === undefined;
      return { name, type, required };
    }
    return { name, type: "string", required: true };
  });
}

function parseSchema(schema: Record<string, unknown> | undefined): StepField[] {
  if (!schema) return [];
  return Object.entries(schema).map(([name, def]) => {
    if (typeof def === "string") return { name, type: def };
    if (def && typeof def === "object") {
      const obj = def as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "string";
      return { name, type };
    }
    return { name, type: "string" };
  });
}

function formatModel(model: SingleAgentManifest["model"]): string {
  if (!model) return "";
  const provider = model.provider ?? "";
  const name = model.name ?? "";
  const temp = typeof model.temperature === "number" ? ` · temp ${model.temperature}` : "";
  const max = typeof model.maxTokens === "number" ? ` · max ${model.maxTokens}` : "";
  return [provider, name].filter(Boolean).join(" · ") + temp + max;
}

function inferBinding(name: string) {
  if (name === "user_id" || name === "userId" || name === "session_id" || name === "sessionId") {
    return { kind: "session" as const, label: `session.${name}` };
  }
  return { kind: "caller" as const, label: "from caller" };
}

/* ── Re-export: editor shell uses this style on header chips ──────────── */
export const headerChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: `1px solid ${ag.line}`,
  borderRadius: 4,
  padding: "3px 8px",
  background: ag.surface2,
};

export function SavingChip({ saving }: { saving: boolean }) {
  if (!saving) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        border: `1px solid ${ag.line}`,
        borderRadius: 4,
        background: ag.surface2,
        fontSize: 11.5,
        color: ag.text2,
      }}
    >
      <Spinner size={11} /> Saving…
    </span>
  );
}
