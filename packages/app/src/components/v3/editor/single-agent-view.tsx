// SingleAgentView — V3 editor layout for a kind=llm manifest. Composes the
// header, view switcher, graph panel, and a manifest-bound inspector.
//
// Reads a parsed manifest (yaml -> JS object) and a couple of callbacks so
// the parent owns the YAML string. The inspector edits push back through
// `onPatch(field, value)` which the parent re-stringifies into YAML.

"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { convertSingleAgentToPipeline } from "./pipeline-mutations";
import { I } from "@/components/v3/icons";
import {
  Btn,
  Mono,
  Spinner,
  Tag,
  VarHl,
  ag,
} from "@/components/v3/primitives";
import type { Catalog } from "@/lib/use-catalog";
import { GraphPanel, GraphValidates } from "./graph-panel";
import { NodeIO, Edge } from "@/components/v3/primitives";
import { PipelineStep, type StepField } from "./pipeline-step";
import { FooterHint, InsSection, StateLine } from "./inspector-bits";
import { EditableNumber, EditableText, EditableToggle } from "./editable-fields";
import { ModelPicker } from "./model-picker";
import { SchemaEditor } from "./schema-editor";
import { ExamplesEditor, type Example } from "./examples-editor";
import { ToolsEditor, type ToolEntry } from "./tools-editor";
import { findBrokenRefs } from "./ref-drift";
import { InstructionPanel } from "./instruction-panel";

export type SingleViewMode = "build" | "yaml" | "instruction" | "both";

export interface SingleAgentManifest {
  id?: string;
  name?: string;
  description?: string;
  kind?: string;
  model?: {
    provider?: string;
    name?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  instruction?: string;
  prompt?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: Example[];
  tools?: Array<Record<string, unknown>>;
  reply?: boolean | { maxPerRun?: number };
  skills?: string[];
}

export function SingleAgentView({
  manifest,
  manifestId,
  view,
  onChangeView,
  onChange,
  catalog,
  rightExtras,
  yamlPanel,
  rightPaneOverride,
}: {
  manifest: SingleAgentManifest;
  manifestId: string;
  view: SingleViewMode;
  onChangeView: (v: SingleViewMode) => void;
  /** Generic patcher — receives a fully-formed next manifest. Phase 2+ editors
   *  call this to commit changes; the parent re-serializes to YAML. */
  onChange?: (next: SingleAgentManifest) => void;
  /** Workspace catalog — providers, mcp servers, tools, agents. Used to
   *  drive the model picker and the tools attachment picker. */
  catalog?: Catalog;
  rightExtras?: ReactNode;
  yamlPanel?: ReactNode;
  /** When provided, replaces the inspector / instruction panel on the right
   *  for every view mode except `yaml` (which has no right column). Used by
   *  the editor page to swap in the Playground panel in play mode. */
  rightPaneOverride?: ReactNode;
}) {
  const inputs = parseInputSchema(manifest.inputSchema);
  const outputs = parseSchema(manifest.outputSchema);
  const modelLine = formatModel(manifest.model);
  const counts = `${inputs.length} input${inputs.length === 1 ? "" : "s"} · ${outputs.length} output${
    outputs.length === 1 ? "" : "s"
  } · ${manifest.examples?.length ?? 0} example${manifest.examples?.length === 1 ? "" : "s"}`;
  const [confirmConvert, setConfirmConvert] = useState(false);
  const handleConvert = () => {
    if (!onChange) return;
    const next = convertSingleAgentToPipeline(manifest);
    // Cast through unknown — the result is a pipeline manifest but onChange's
    // typing is keyed to the single-agent shape. The parent re-parses it from
    // YAML on the next render and the editor swaps to PipelineView.
    onChange(next as unknown as SingleAgentManifest);
    setConfirmConvert(false);
  };

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
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns:
            view === "yaml"
              ? "1fr"
              : view === "both"
                ? "1fr 1fr 420px"
                : view === "instruction"
                  ? "1fr 1fr"
                  : "1fr 420px",
          minHeight: 0,
        }}
      >
        {(view === "build" || view === "both" || view === "instruction") && (
          <GraphPanel
            topRight={
              <Btn
                variant="secondary"
                size="sm"
                icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
                onClick={onChange ? () => setConfirmConvert(true) : undefined}
                disabled={!onChange}
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

        {view !== "yaml" && rightPaneOverride ? (
          rightPaneOverride
        ) : view === "instruction" ? (
          <InstructionPanel
            agentName={manifest.name ?? manifestId}
            agentId={manifestId}
            instruction={manifest.instruction ?? ""}
            prompt={manifest.prompt ?? ""}
            onChangeInstruction={onChange ? (v) => onChange({ ...manifest, instruction: v || undefined }) : undefined}
            onChangePrompt={onChange ? (v) => onChange({ ...manifest, prompt: v || undefined }) : undefined}
          />
        ) : view !== "yaml" ? (
          <SingleAgentInspector
            manifest={manifest}
            manifestId={manifestId}
            inputs={inputs}
            outputs={outputs}
            catalog={catalog}
            onChange={onChange}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmConvert}
        title="Convert to a pipeline?"
        message={`The "${manifest.name ?? manifestId}" agent will become a sequential pipeline with a single inner LLM step. You can then add more steps, fan-out branches, or insert tool calls between them. The agent's id and external inputs stay the same.`}
        confirmLabel="Convert"
        onConfirm={handleConvert}
        onCancel={() => setConfirmConvert(false)}
      />
    </div>
  );
}

function SingleAgentInspector({
  manifest,
  manifestId,
  inputs,
  outputs,
  catalog,
  onChange,
}: {
  manifest: SingleAgentManifest;
  manifestId: string;
  inputs: StepField[];
  outputs: StepField[];
  catalog?: Catalog;
  onChange?: (next: SingleAgentManifest) => void;
}) {
  // Single patcher — every editable field calls patch({ field: value }) so the
  // inspector never sees stale closure values.
  const patch = (next: Partial<SingleAgentManifest>) => onChange?.({ ...manifest, ...next });
  const patchModel = (next: Partial<NonNullable<SingleAgentManifest["model"]>>) =>
    patch({ model: stripUndefined({ ...(manifest.model ?? {}), ...next }) });

  const handleInstruction = onChange ? (next: string) => patch({ instruction: next }) : undefined;
  const replyEnabled = manifest.reply === true || (typeof manifest.reply === "object" && manifest.reply !== null);
  const skillsText = (manifest.skills ?? []).join(", ");

  // Reference-drift: list any `{{var}}` refs in instruction/prompt that aren't
  // declared inputs. `userQuery` is built-in and always allowed.
  const inScope = inputs.map((i) => i.name);
  const brokenInstructionRefs = findBrokenRefs(manifest.instruction ?? "", inScope);
  const brokenPromptRefs = findBrokenRefs(manifest.prompt ?? "", inScope);
  const allBrokenRefs = Array.from(new Set([...brokenInstructionRefs, ...brokenPromptRefs]));

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
        {allBrokenRefs.length > 0 && (
          <div
            style={{
              margin: "12px 16px 0",
              padding: "8px 10px",
              border: `1px solid ${ag.warn}`,
              borderRadius: 4,
              background: ag.warnBg,
              color: ag.warn,
              fontSize: 11.5,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <I.X size={11} style={{ marginTop: 2, flex: "0 0 auto" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {allBrokenRefs.length} unresolved reference
                {allBrokenRefs.length === 1 ? "" : "s"}
              </div>
              <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
                {allBrokenRefs.map((ref) => `{{${ref}}}`).join(", ")}
              </div>
              <div style={{ marginTop: 4, color: ag.text2 }}>
                These names aren&apos;t declared as inputs. Add them to the schema below or
                remove the references. (Saving still works — runtime templates will leave
                them empty.)
              </div>
            </div>
          </div>
        )}
        {/* Inputs */}
        <div style={{ padding: "16px 16px 8px" }}>
          <div style={{ marginBottom: 10 }}>
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
              Fields the caller passes in. Each one is available as{" "}
              <span style={{ fontFamily: "var(--font-mono)" }}>{`{{name}}`}</span> in the
              instruction.
            </div>
          </div>
          <SchemaEditor
            kind="input"
            schema={manifest.inputSchema}
            onChange={(next) => patch({ inputSchema: next })}
            emptyMessage="No inputs declared. The agent will use the caller's raw message."
          />
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
            <EditableText
              label="Description"
              value={manifest.description ?? ""}
              onChange={onChange ? (description) => patch({ description: description || undefined }) : () => {}}
              placeholder="What does this agent do?"
              multiline
              rows={2}
            />
            <ModelPicker
              value={{ provider: manifest.model?.provider ?? "", name: manifest.model?.name ?? "" }}
              providers={catalog?.providers ?? []}
              loading={catalog?.loading}
              onChange={(next) => patchModel({ provider: next.provider, name: next.name })}
            />
            <InstructionBlock
              instruction={manifest.instruction ?? ""}
              onChange={handleInstruction}
              brokenRefs={brokenInstructionRefs}
            />
          </InsSection>

          <InsSection title="Tools" badge={`${manifest.tools?.length ?? 0} attached`}>
            <ToolsEditor
              tools={(manifest.tools ?? []) as ToolEntry[]}
              onChange={(next) => patch({ tools: next as Array<Record<string, unknown>> | undefined })}
              mcpServers={catalog?.mcpServers ?? []}
              localTools={catalog?.tools ?? []}
              agents={catalog?.agents ?? []}
              loadMcpTools={catalog?.loadMcpTools ?? (async () => [])}
              loadMcpToolsForUrl={catalog?.loadMcpToolsForUrl}
              mcpToolsByServer={catalog?.mcpToolsByServer ?? {}}
              currentAgentId={manifest.id}
              rootManifest={manifest as unknown}
            />
          </InsSection>

          <InsSection title="Output schema" badge={`${outputs.length} field${outputs.length === 1 ? "" : "s"}`}>
            <SchemaEditor
              kind="output"
              schema={manifest.outputSchema}
              onChange={(next) => patch({ outputSchema: next })}
            />
          </InsSection>

          <InsSection
            title="Examples"
            badge={`${manifest.examples?.length ?? 0} pinned`}
          >
            <ExamplesEditor
              examples={manifest.examples ?? []}
              onChange={(next) => patch({ examples: next })}
            />
          </InsSection>

          <InsSection title="Advanced">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <EditableNumber
                label="Temperature"
                value={manifest.model?.temperature}
                onChange={(v) => patchModel({ temperature: v })}
                min={0}
                max={2}
                step={0.1}
                placeholder="—"
                hint="0–2, blank = provider default"
              />
              <EditableNumber
                label="Max tokens"
                value={manifest.model?.maxTokens}
                onChange={(v) => patchModel({ maxTokens: v })}
                min={1}
                step={1}
                placeholder="—"
              />
              <EditableNumber
                label="Top P"
                value={manifest.model?.topP}
                onChange={(v) => patchModel({ topP: v })}
                min={0}
                max={1}
                step={0.05}
                placeholder="—"
                hint="0–1"
              />
              <div />
            </div>
            <EditableToggle
              label="Reply tool — model can stream intermediate messages"
              value={replyEnabled}
              onChange={(enabled) =>
                patch({ reply: enabled ? true : undefined })
              }
              hint={
                typeof manifest.reply === "object"
                  ? `maxPerRun: ${manifest.reply.maxPerRun ?? "default"} (edit in YAML to change)`
                  : undefined
              }
            />
            <EditableText
              label="Skills"
              value={skillsText}
              onChange={(text) => {
                const parts = text
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                patch({ skills: parts.length ? parts : undefined });
              }}
              placeholder="comma-separated skill names"
            />
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
  brokenRefs,
}: {
  instruction: string;
  onChange?: (next: string) => void;
  brokenRefs?: string[];
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
      {brokenRefs && brokenRefs.length > 0 && (
        <div
          style={{
            marginTop: 6,
            padding: "5px 8px",
            border: `1px solid ${ag.warn}`,
            borderRadius: 3,
            background: ag.warnBg,
            color: ag.warn,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          title="These refs aren't in the agent's input scope."
        >
          <I.X size={10} />
          {brokenRefs.length === 1
            ? `${brokenRefs[0]} isn't declared as an input`
            : `${brokenRefs.length} refs aren't declared inputs:`}
          {brokenRefs.length > 1 && (
            <span style={{ fontWeight: 500 }}>{brokenRefs.join(", ")}</span>
          )}
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

/** Drop keys whose value is `undefined`. Used when patching nested objects so
 *  the YAML serializer doesn't emit explicit nulls for fields the user cleared. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
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
