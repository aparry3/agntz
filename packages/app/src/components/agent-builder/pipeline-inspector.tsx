"use client";

// Right-side inspector for the pipeline view. Reads the selected
// `PipelineNode` and writes field edits back through `setField`. The
// inspector consolidates every "config feature" the YAML supports:
//
//   • IDENTITY · id / name / description / kind
//   • INPUT SCHEMA · root agent inputs
//   • AVAILABLE STATE · what {{vars}} the node can reference
//   • INPUT MAPPING · two-column mapper (StepRef.input or tool.params)
//   • MODEL · provider / model / temperature / max-tokens / top-p
//   • INSTRUCTION · system prompt with {{template}} highlighting
//   • TOOLS · local / mcp / agent / http with secrets + placeholders
//   • SPAWNABLE · sub-agents the LLM may spawn
//   • SKILLS · skill names the agent may load mid-run
//   • REPLY · opt-in intermediate-message tool
//   • OUTPUT SCHEMA · structured output fields
//   • OUTPUT DESTINATION · stateKey on parent state
//   • LOOP · until + maxIterations on a sequential container
//   • OUTPUT MAPPING · root-level state-to-output projection

import { useMemo, useState, type ReactNode } from "react";
import { AGENT_KINDS, PROPERTY_TYPES, TOOL_ENTRY_KINDS, type AgentKindOption, type PropertyType, type ToolEntryKind } from "@/lib/manifest-catalog";
import type { Catalog } from "@/lib/use-catalog";
import { HeadersEditor } from "./headers-editor";
import { ParamsEditor } from "./params-editor";
import { PlaceholderPreview } from "./placeholder-preview";
import { parseUrlPlaceholders } from "@agntz/manifest";
import {
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  KIND_COLORS,
  NEUTRAL,
} from "./pipeline-tokens";
import {
  computeAvailableStateAt,
  isRecord,
  type PipelineNode,
  type PipelinePath,
  type StateRef,
  type StateSnapshot,
} from "./pipeline-types";

export interface InspectorProps {
  pipeline: PipelineNode;
  selected: PipelineNode;
  parsedManifest: Record<string, unknown>;
  catalog: Catalog;
  setField: (path: PipelinePath, value: unknown) => void;
  idLocked: boolean;
  /**
   * Remove the selected node from its parent's `steps` / `branches` array.
   * Only wired for non-root nodes — the inspector hides the affordance for
   * the root agent (which has no enclosing array).
   */
  onRemove?: (node: PipelineNode) => void;
}

export function PipelineInspector(props: InspectorProps) {
  const snapshot = useMemo(
    () => computeAvailableStateAt(props.pipeline, props.selected.id),
    [props.pipeline, props.selected.id],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        fontFamily: FONT_SANS,
        color: NEUTRAL.text,
      }}
    >
      <Header
        node={props.selected}
        onRemove={
          props.onRemove && !props.selected.isRoot
            ? () => props.onRemove?.(props.selected)
            : undefined
        }
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <InspectorBody {...props} snapshot={snapshot} />
      </div>
    </div>
  );
}

function Header({ node, onRemove }: { node: PipelineNode; onRemove?: () => void }) {
  const c = KIND_COLORS[node.kind];
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${NEUTRAL.border}`,
        background: c.bg,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 6,
            background: c.bgHeader,
            border: `1px solid ${c.border}`,
            color: c.text,
            fontFamily: FONT_MONO,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 7, background: c.dot }} />
          {c.label}
        </span>
        {node.isLoop && (
          <span
            style={{
              padding: "3px 8px",
              borderRadius: 5,
              background: "#fff",
              border: `1px solid ${c.border}`,
              color: c.text,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            ↻ LOOP
          </span>
        )}
        <span style={{ flex: 1 }} />
        {node.isRoot && (
          <span
            style={{
              padding: "2px 7px",
              borderRadius: 4,
              background: "#fff",
              border: `1px solid ${NEUTRAL.borderStrong}`,
              fontFamily: FONT_MONO,
              fontSize: 10,
              fontWeight: 600,
              color: NEUTRAL.ink,
            }}
          >
            ROOT
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this step"
            aria-label="Remove this step"
            style={{
              padding: "3px 9px",
              borderRadius: 5,
              background: "#fff",
              border: "1px solid #fecaca",
              color: "#dc2626",
              fontFamily: FONT_SANS,
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>×</span>
            Remove
          </button>
        )}
      </div>
      <div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            fontWeight: 500,
            color: NEUTRAL.text,
            letterSpacing: "-0.01em",
          }}
        >
          {node.name}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: NEUTRAL.textMuted, marginTop: 2 }}>
          {node.id}
        </div>
      </div>
    </div>
  );
}

function InspectorBody(props: InspectorProps & { snapshot: StateSnapshot }) {
  const { selected } = props;

  return (
    <>
      {selected.isRoot && <RootIdentitySection {...props} />}
      {selected.isRoot && <InputSchemaSection {...props} />}

      <AvailableStateSection snapshot={props.snapshot} highlight={highlightFromInput(selected)} />

      {selected.stepPath && <InputMappingSection {...props} />}

      {selected.kind === "llm" && (
        <>
          <ModelSection {...props} />
          <InstructionSection {...props} />
          <ToolsSection {...props} />
          <SpawnableSection {...props} />
          <SkillsSection {...props} />
          <ReplySection {...props} />
          <OutputSchemaSection {...props} />
        </>
      )}

      {selected.kind === "tool" && <ToolCallSection {...props} />}

      {selected.kind === "sequential" && <LoopSection {...props} />}

      {!selected.isRoot && <OutputDestinationSection {...props} />}

      {selected.isRoot &&
        (selected.kind === "sequential" || selected.kind === "parallel") && (
          <OutputMappingSection {...props} />
        )}
    </>
  );
}

function highlightFromInput(node: PipelineNode): string[] {
  if (!node.inputMap) return [];
  return Object.values(node.inputMap)
    .flatMap((v) => v.match(/\{\{\s*([^}]+?)\s*\}\}/g) ?? [])
    .map((v) => v.replace(/[{}\s]/g, "").split(".")[0]);
}

// ─── Section primitive ───────────────────────────────────────────────────

function Section({
  title,
  action,
  children,
  collapsible,
  defaultExpanded = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const isOpen = collapsible ? open : true;
  return (
    <section style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
      <header
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          cursor: collapsible ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: FONT_MONO,
            fontSize: 9.5,
            fontWeight: 700,
            color: NEUTRAL.textMuted,
            letterSpacing: "0.12em",
          }}
        >
          {collapsible && (
            <span
              style={{
                display: "inline-block",
                transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 120ms",
                color: NEUTRAL.textSubtle,
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              ▸
            </span>
          )}
          {title}
        </span>
        {action}
      </header>
      {isOpen && <div style={{ padding: "0 16px 14px" }}>{children}</div>}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontFamily: FONT_SANS,
        fontSize: 11,
        color: NEUTRAL.textMuted,
        fontWeight: 500,
        marginBottom: 4,
      }}
    >
      {children}
    </label>
  );
}

const baseInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 6,
  background: "#fff",
  border: `1px solid ${NEUTRAL.border}`,
  fontSize: 12.5,
  color: NEUTRAL.ink,
  outline: "none",
};

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      style={{
        ...baseInputStyle,
        fontFamily: mono ? FONT_MONO : FONT_SANS,
        background: readOnly ? NEUTRAL.paperBg2 : "#fff",
        color: readOnly ? NEUTRAL.textMuted : NEUTRAL.ink,
      }}
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 6,
  mono,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      style={{
        ...baseInputStyle,
        fontFamily: mono ? FONT_MONO : FONT_SANS,
        resize: "vertical",
        lineHeight: 1.5,
      }}
    />
  );
}

function NumberField({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const num = Number(raw);
        if (Number.isFinite(num)) onChange(num);
      }}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      style={{ ...baseInputStyle, fontFamily: FONT_MONO }}
    />
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
  allowEmpty,
  emptyLabel,
}: {
  value: T | "";
  onChange: (next: T | "") => void;
  options: Array<{ value: T; label: string; hint?: string }>;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T | "")}
      style={{ ...baseInputStyle, fontFamily: FONT_SANS }}
    >
      {allowEmpty && <option value="">{emptyLabel ?? "—"}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
          {option.hint ? ` · ${option.hint}` : ""}
        </option>
      ))}
    </select>
  );
}

function SmallButton({
  label,
  onClick,
  tone = "neutral",
  disabled,
}: {
  label: string;
  onClick: () => void;
  tone?: "neutral" | "danger" | "primary";
  disabled?: boolean;
}) {
  const palette =
    tone === "danger"
      ? { bg: "#fff", border: "#fecaca", text: "#dc2626" }
      : tone === "primary"
        ? { bg: NEUTRAL.text, border: NEUTRAL.text, text: "#fff" }
        : { bg: "#fff", border: NEUTRAL.border, text: NEUTRAL.text };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        fontFamily: FONT_SANS,
        fontSize: 11,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ─── Available state browser ─────────────────────────────────────────────

function AvailableStateSection({
  snapshot,
  highlight,
}: {
  snapshot: StateSnapshot;
  highlight: string[];
}) {
  return (
    <Section title={`AVAILABLE STATE · ${snapshot.scope}`} collapsible defaultExpanded>
      <div
        style={{
          background: NEUTRAL.paperBg,
          border: `1px solid ${NEUTRAL.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          fontFamily: FONT_MONO,
          fontSize: 11,
        }}
      >
        {snapshot.keys.length === 0 ? (
          <div style={{ color: NEUTRAL.textSubtle, fontStyle: "italic" }}>
            No state available yet.
          </div>
        ) : (
          snapshot.keys.map((k) => <StateRow key={k.key} k={k} depth={0} highlight={highlight} />)
        )}
      </div>
      <p
        style={{
          margin: "8px 2px 0",
          fontFamily: FONT_SANS,
          fontSize: 11,
          color: NEUTRAL.textSubtle,
          lineHeight: 1.5,
        }}
      >
        State is scoped to this pipeline. Sub-agents can&apos;t see parent state. Only the keys
        above can be referenced as{" "}
        <code style={{ fontFamily: FONT_MONO, color: NEUTRAL.textMuted }}>{"{{...}}"}</code>.
      </p>
    </Section>
  );
}

function StateRow({
  k,
  depth,
  highlight,
}: {
  k: StateRef;
  depth: number;
  highlight: string[];
}) {
  const isObject = !!k.children;
  const isHighlighted = highlight.includes(k.key);
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 4px",
          borderRadius: 4,
          background: isHighlighted ? "oklch(0.94 0.04 245)" : "transparent",
        }}
      >
        <span style={{ color: NEUTRAL.borderStrong }}>{isObject ? "▾" : "·"}</span>
        <span style={{ color: NEUTRAL.ink, fontWeight: 600 }}>{k.key}</span>
        <span style={{ color: NEUTRAL.textSubtle }}>:{k.type}</span>
        <span
          style={{
            marginLeft: "auto",
            color: k.source === "input" ? NEUTRAL.textSubtle : NEUTRAL.textMuted,
            fontSize: 9.5,
          }}
        >
          {k.source === "input" ? "input" : `← ${k.source}`}
        </span>
      </div>
      {isObject &&
        k.children?.map((c) => (
          <div key={c.key} style={{ paddingLeft: (depth + 1) * 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 4px",
              }}
            >
              <span style={{ color: NEUTRAL.borderStrong }}>·</span>
              <span style={{ color: NEUTRAL.ink, fontWeight: 600 }}>{c.key}</span>
              <span style={{ color: NEUTRAL.textSubtle }}>:{c.type}</span>
            </div>
          </div>
        ))}
    </div>
  );
}

// ─── Root: identity + input schema ───────────────────────────────────────

function RootIdentitySection({ selected, parsedManifest, setField, idLocked }: InspectorProps) {
  const id = asString(parsedManifest.id) ?? "";
  const name = asString(parsedManifest.name) ?? "";
  const description = asString(parsedManifest.description) ?? "";
  const kindValue = asString(parsedManifest.kind) ?? "";
  const kind: AgentKindOption | "" = (AGENT_KINDS as readonly string[]).includes(kindValue)
    ? (kindValue as AgentKindOption)
    : "";

  // selected is unused — kept in signature for symmetry with other sections.
  void selected;

  return (
    <Section title="IDENTITY">
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <FieldLabel>Agent ID</FieldLabel>
          <TextInput
            value={id}
            onChange={(v) => setField(["id"], v)}
            placeholder="my-agent-id"
            mono
            readOnly={idLocked}
          />
          {idLocked && (
            <p style={{ margin: "4px 2px 0", fontFamily: FONT_SANS, fontSize: 11, color: NEUTRAL.textSubtle }}>
              The ID is locked after creation.
            </p>
          )}
        </div>
        <div>
          <FieldLabel>Display name</FieldLabel>
          <TextInput
            value={name}
            onChange={(v) => setField(["name"], v || undefined)}
            placeholder="My Agent"
          />
        </div>
        <div>
          <FieldLabel>Kind</FieldLabel>
          <SelectInput<AgentKindOption>
            value={kind}
            onChange={(v) => {
              if (v) setField(["kind"], v);
            }}
            options={AGENT_KINDS.map((k) => ({ value: k, label: k }))}
          />
        </div>
        <div>
          <FieldLabel>Description</FieldLabel>
          <TextArea
            value={description}
            onChange={(v) => setField(["description"], v || undefined)}
            placeholder="What does this agent do?"
            rows={2}
          />
        </div>
      </div>
    </Section>
  );
}

function InputSchemaSection({ parsedManifest, setField }: InspectorProps) {
  const raw = isRecord(parsedManifest.inputSchema) ? parsedManifest.inputSchema : {};
  const fields = Object.entries(raw).map(([key, def]) => {
    if (typeof def === "string") return { key, type: def, default: undefined as unknown };
    if (isRecord(def))
      return { key, type: asString(def.type) ?? "string", default: def.default };
    return { key, type: "string", default: undefined };
  });

  const writeAll = (next: Array<{ key: string; type: string; default: unknown }>) => {
    if (next.length === 0) {
      setField(["inputSchema"], undefined);
      return;
    }
    const out: Record<string, unknown> = {};
    for (const f of next) {
      if (!f.key.trim()) continue;
      if (f.default !== undefined && f.default !== "") {
        out[f.key] = { type: f.type, default: f.default };
      } else {
        out[f.key] = f.type;
      }
    }
    setField(["inputSchema"], Object.keys(out).length > 0 ? out : undefined);
  };

  return (
    <Section
      title="INPUT SCHEMA"
      action={
        <SmallButton
          label="+ Add field"
          onClick={() => writeAll([...fields, { key: "", type: "string", default: undefined }])}
        />
      }
    >
      {fields.length === 0 ? (
        <EmptyHint>No input fields declared.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {fields.map((field, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 110px auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <TextInput
                value={field.key}
                onChange={(v) => {
                  const next = [...fields];
                  next[idx] = { ...next[idx], key: v };
                  writeAll(next);
                }}
                placeholder="topic"
                mono
              />
              <SelectInput<PropertyType>
                value={(field.type as PropertyType) ?? ""}
                onChange={(v) => {
                  const next = [...fields];
                  next[idx] = { ...next[idx], type: v || "string" };
                  writeAll(next);
                }}
                options={PROPERTY_TYPES.map((t) => ({ value: t, label: t }))}
              />
              <SmallButton
                label="✕"
                tone="danger"
                onClick={() => writeAll(fields.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Input mapping (two-column mapper) ───────────────────────────────────

function InputMappingSection({ selected, setField }: InspectorProps) {
  if (!selected.stepPath) return null;
  const inputs = selected.inputSchema ?? [];
  const inputMap = selected.inputMap ?? {};

  const writeMap = (next: Record<string, string>) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) {
      if (v.trim().length > 0) clean[k] = v;
    }
    setField([...selected.stepPath!, "input"], Object.keys(clean).length > 0 ? clean : undefined);
  };

  // If no inputSchema is declared, the LLM gets a free-form prompt — but the
  // user can still pin state to ad-hoc input keys; show whatever pins exist.
  const knownKeys = inputs.length > 0 ? inputs.map((f) => f.key) : Object.keys(inputMap);

  return (
    <Section title="INPUT MAPPING">
      {knownKeys.length === 0 ? (
        <EmptyHint>
          No declared inputs. Pin keys here to expose state variables to the child.
          <div style={{ marginTop: 6 }}>
            <SmallButton
              label="+ Add mapping"
              onClick={() => writeMap({ ...inputMap, "": "" })}
            />
          </div>
        </EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 14px minmax(0, 1.4fr)",
              gap: 8,
              alignItems: "center",
              fontFamily: FONT_MONO,
              fontSize: 9.5,
              color: NEUTRAL.textSubtle,
              fontWeight: 700,
              letterSpacing: "0.1em",
              paddingLeft: 4,
              paddingRight: 4,
            }}
          >
            <span>CHILD INPUT</span>
            <span />
            <span>SOURCE</span>
          </div>
          {knownKeys.map((key) => {
            const schemaField = inputs.find((f) => f.key === key);
            const mapped = inputMap[key] ?? "";
            return (
              <div
                key={key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 14px minmax(0, 1.4fr)",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    padding: "6px 8px",
                    borderRadius: 6,
                    background: NEUTRAL.paperBg,
                    border: `1px solid ${NEUTRAL.border}`,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                  }}
                >
                  <span style={{ color: NEUTRAL.ink, fontWeight: 600 }}>{key}</span>
                  {schemaField && (
                    <span style={{ color: NEUTRAL.textSubtle }}>
                      :{schemaField.type}
                      {schemaField.nullable ? "?" : ""}
                    </span>
                  )}
                </div>
                <span style={{ textAlign: "center", color: NEUTRAL.borderStrong }}>←</span>
                <TextInput
                  value={mapped}
                  onChange={(v) => writeMap({ ...inputMap, [key]: v })}
                  placeholder="{{state.path}}"
                  mono
                />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─── LLM-specific sections ───────────────────────────────────────────────

function ModelSection({ selected, parsedManifest, catalog, setField }: InspectorProps) {
  const agent = getAtPath(parsedManifest, selected.agentPath) ?? {};
  const model = isRecord((agent as Record<string, unknown>).model)
    ? ((agent as Record<string, unknown>).model as Record<string, unknown>)
    : {};
  const provider = asString(model.provider) ?? "";
  const name = asString(model.name) ?? "";
  const temperature = typeof model.temperature === "number" ? model.temperature : undefined;
  const maxTokens = typeof model.maxTokens === "number" ? model.maxTokens : undefined;
  const topP = typeof model.topP === "number" ? model.topP : undefined;

  const providerOption = catalog.providers.find((p) => p.id === provider);
  const models = providerOption?.models ?? [];

  const writeModel = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = {
      provider: patch.provider !== undefined ? patch.provider : provider,
      name: patch.name !== undefined ? patch.name : name,
    };
    const tempVal = patch.temperature !== undefined ? patch.temperature : temperature;
    const tokenVal = patch.maxTokens !== undefined ? patch.maxTokens : maxTokens;
    const topPVal = patch.topP !== undefined ? patch.topP : topP;
    if (tempVal !== undefined) next.temperature = tempVal;
    if (tokenVal !== undefined) next.maxTokens = tokenVal;
    if (topPVal !== undefined) next.topP = topPVal;
    setField([...selected.agentPath, "model"], next);
  };

  return (
    <Section title="MODEL">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1.4fr" }}>
          <div>
            <FieldLabel>Provider</FieldLabel>
            <SelectInput<string>
              value={provider}
              onChange={(v) => writeModel({ provider: v })}
              options={catalog.providers.map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.configured ? undefined : "not configured",
              }))}
              allowEmpty
              emptyLabel="Select…"
            />
          </div>
          <div>
            <FieldLabel>Model</FieldLabel>
            {models.length > 0 ? (
              <SelectInput<string>
                value={models.includes(name) ? name : ""}
                onChange={(v) => writeModel({ name: v })}
                options={models.map((m) => ({ value: m, label: m }))}
                allowEmpty
                emptyLabel={name || "Select a model…"}
              />
            ) : (
              <TextInput
                value={name}
                onChange={(v) => writeModel({ name: v })}
                placeholder="model name"
                mono
              />
            )}
          </div>
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <FieldLabel>Temperature</FieldLabel>
            <NumberField
              value={temperature}
              onChange={(v) => writeModel({ temperature: v })}
              min={0}
              max={2}
              step={0.1}
              placeholder="0.7"
            />
          </div>
          <div>
            <FieldLabel>Max tokens</FieldLabel>
            <NumberField
              value={maxTokens}
              onChange={(v) => writeModel({ maxTokens: v })}
              min={1}
              step={64}
              placeholder="auto"
            />
          </div>
          <div>
            <FieldLabel>Top P</FieldLabel>
            <NumberField
              value={topP}
              onChange={(v) => writeModel({ topP: v })}
              min={0}
              max={1}
              step={0.05}
              placeholder="1.0"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

function InstructionSection({ selected, parsedManifest, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const instruction = asString(agent.instruction) ?? "";
  return (
    <Section title="INSTRUCTION">
      <TextArea
        value={instruction}
        onChange={(v) => setField([...selected.agentPath, "instruction"], v || undefined)}
        placeholder="You are a helpful assistant."
        rows={9}
        mono
      />
    </Section>
  );
}

function OutputSchemaSection({ selected, parsedManifest, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const raw = isRecord(agent.outputSchema) ? agent.outputSchema : {};
  const fields = Object.entries(raw).map(([key, def]) => {
    if (typeof def === "string") return { key, type: def };
    if (isRecord(def)) return { key, type: asString(def.type) ?? "string" };
    return { key, type: "string" };
  });

  const writeAll = (next: Array<{ key: string; type: string }>) => {
    if (next.length === 0) {
      setField([...selected.agentPath, "outputSchema"], undefined);
      return;
    }
    const out: Record<string, unknown> = {};
    for (const f of next) {
      if (!f.key.trim()) continue;
      out[f.key] = f.type;
    }
    setField(
      [...selected.agentPath, "outputSchema"],
      Object.keys(out).length > 0 ? out : undefined,
    );
  };

  return (
    <Section
      title="OUTPUT SCHEMA"
      action={
        <SmallButton
          label="+ Add field"
          onClick={() => writeAll([...fields, { key: "", type: "string" }])}
        />
      }
    >
      {fields.length === 0 ? (
        <EmptyHint>No structured output. Treat as free-form text.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fields.map((field, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 110px auto",
                gap: 6,
              }}
            >
              <TextInput
                value={field.key}
                onChange={(v) => {
                  const next = [...fields];
                  next[idx] = { ...next[idx], key: v };
                  writeAll(next);
                }}
                placeholder="result"
                mono
              />
              <SelectInput<PropertyType>
                value={(field.type as PropertyType) ?? ""}
                onChange={(v) => {
                  const next = [...fields];
                  next[idx] = { ...next[idx], type: v || "string" };
                  writeAll(next);
                }}
                options={PROPERTY_TYPES.map((t) => ({ value: t, label: t }))}
              />
              <SmallButton
                label="✕"
                tone="danger"
                onClick={() => writeAll(fields.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Tools section (incl. HTTP) ──────────────────────────────────────────

interface ToolDraft {
  kind: ToolEntryKind | "";
  tools: string[];
  server?: string;
  agent?: string;
  name?: string;
  url?: string;
  method?: "GET";
  description?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

function readToolDraft(value: unknown): ToolDraft {
  if (!isRecord(value)) return { kind: "", tools: [] };
  const kind = asString(value.kind);
  if (kind === "local") {
    const tools = Array.isArray(value.tools)
      ? value.tools.filter((t): t is string => typeof t === "string")
      : [];
    return { kind: "local", tools };
  }
  if (kind === "mcp") {
    const tools = Array.isArray(value.tools)
      ? value.tools
          .map((t) => (typeof t === "string" ? t : isRecord(t) && typeof t.tool === "string" ? t.tool : null))
          .filter((t): t is string => t !== null)
      : [];
    return { kind: "mcp", tools, server: asString(value.server) };
  }
  if (kind === "agent") {
    return { kind: "agent", tools: [], agent: asString(value.agent) };
  }
  if (kind === "http") {
    return {
      kind: "http",
      tools: [],
      name: asString(value.name),
      url: asString(value.url),
      method: value.method === "GET" ? "GET" : undefined,
      description: asString(value.description),
      params: readStringMap(value.params),
      headers: readStringMap(value.headers),
    };
  }
  return { kind: "", tools: [] };
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  let saw = false;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      out[k] = v;
      saw = true;
    }
  }
  return saw ? out : undefined;
}

function writeToolDraft(entry: ToolDraft): unknown {
  if (entry.kind === "local") return { kind: "local", tools: entry.tools };
  if (entry.kind === "mcp") {
    const out: Record<string, unknown> = { kind: "mcp" };
    if (entry.server) out.server = entry.server;
    if (entry.tools.length > 0) out.tools = entry.tools;
    return out;
  }
  if (entry.kind === "agent") {
    const out: Record<string, unknown> = { kind: "agent" };
    if (entry.agent) out.agent = entry.agent;
    return out;
  }
  if (entry.kind === "http") {
    const out: Record<string, unknown> = { kind: "http" };
    if (entry.name) out.name = entry.name;
    if (entry.url) out.url = entry.url;
    if (entry.method && entry.method !== "GET") out.method = entry.method;
    if (entry.description) out.description = entry.description;
    if (entry.params && Object.keys(entry.params).length > 0) out.params = entry.params;
    if (entry.headers && Object.keys(entry.headers).length > 0) out.headers = entry.headers;
    return out;
  }
  return {};
}

function ToolsSection({ selected, parsedManifest, catalog, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const raw = Array.isArray(agent.tools) ? agent.tools : [];
  const entries: ToolDraft[] = raw.map(readToolDraft);

  const writeAll = (next: ToolDraft[]) => {
    const filtered = next.filter((e) => e.kind !== "");
    if (filtered.length === 0) {
      setField([...selected.agentPath, "tools"], undefined);
      return;
    }
    setField([...selected.agentPath, "tools"], filtered.map(writeToolDraft));
  };

  return (
    <Section
      title="TOOLS"
      action={
        <SmallButton
          label="+ Add tool"
          onClick={() => writeAll([...entries, { kind: "", tools: [] }])}
        />
      }
    >
      {entries.length === 0 ? (
        <EmptyHint>No tools attached.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {entries.map((entry, idx) => (
            <ToolEntryBlock
              key={idx}
              entry={entry}
              catalog={catalog}
              onChange={(patch) => {
                const next = [...entries];
                next[idx] = { ...next[idx], ...patch };
                writeAll(next);
              }}
              onRemove={() => writeAll(entries.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function ToolEntryBlock({
  entry,
  catalog,
  onChange,
  onRemove,
}: {
  entry: ToolDraft;
  catalog: Catalog;
  onChange: (patch: Partial<ToolDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 8,
        background: NEUTRAL.paperBg,
        border: `1px solid ${NEUTRAL.border}`,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>Kind</FieldLabel>
          <SelectInput<ToolEntryKind>
            value={entry.kind}
            onChange={(v) => {
              if (!v) {
                onChange({
                  kind: "",
                  tools: [],
                  server: undefined,
                  agent: undefined,
                  name: undefined,
                  url: undefined,
                  method: undefined,
                  description: undefined,
                  params: undefined,
                  headers: undefined,
                });
              } else {
                onChange({
                  kind: v,
                  tools: [],
                  server: undefined,
                  agent: undefined,
                  name: undefined,
                  url: undefined,
                  method: undefined,
                  description: undefined,
                  params: undefined,
                  headers: undefined,
                });
              }
            }}
            options={TOOL_ENTRY_KINDS.map((k) => ({ value: k, label: k }))}
            allowEmpty
            emptyLabel="Select…"
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <SmallButton label="Remove" tone="danger" onClick={onRemove} />
        </div>
      </div>

      {entry.kind === "local" && (
        <div>
          <FieldLabel>Tool names</FieldLabel>
          <CommaList
            values={entry.tools}
            onChange={(next) => onChange({ tools: next })}
            placeholder="calculator, date_formatter"
            suggestions={catalog.tools.filter((t) => t.source === "inline").map((t) => t.name)}
          />
        </div>
      )}

      {entry.kind === "mcp" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <FieldLabel>Server</FieldLabel>
            <SelectInput<string>
              value={entry.server ?? ""}
              onChange={(v) => onChange({ server: v || undefined, tools: [] })}
              options={catalog.mcpServers.map((s) => ({ value: s.id, label: s.displayName }))}
              allowEmpty
              emptyLabel="Select server…"
            />
          </div>
          <div>
            <FieldLabel>Tools (blank = all)</FieldLabel>
            <CommaList
              values={entry.tools}
              onChange={(next) => onChange({ tools: next })}
              placeholder="leave blank for all"
            />
          </div>
        </div>
      )}

      {entry.kind === "agent" && (
        <div>
          <FieldLabel>Agent</FieldLabel>
          <SelectInput<string>
            value={entry.agent ?? ""}
            onChange={(v) => onChange({ agent: v || undefined })}
            options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))}
            allowEmpty
            emptyLabel="Select agent…"
          />
        </div>
      )}

      {entry.kind === "http" && <HttpToolEditor entry={entry} catalog={catalog} onChange={onChange} />}

      {entry.kind === "" && (
        <EmptyHint>Pick a kind to configure this tool entry.</EmptyHint>
      )}
    </div>
  );
}

const HTTP_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function HttpToolEditor({
  entry,
  catalog,
  onChange,
}: {
  entry: ToolDraft;
  catalog: Catalog;
  onChange: (patch: Partial<ToolDraft>) => void;
}) {
  const url = entry.url ?? "";
  const params = entry.params ?? {};
  const headers = entry.headers ?? {};

  const placeholders = useMemo(() => (url ? parseUrlPlaceholders(url) : []), [url]);
  const optionalInPath = useMemo(
    () => placeholders.some((p) => p.position === "path" && p.optional),
    [placeholders],
  );
  const nameInvalid =
    entry.name != null && entry.name.length > 0 && !HTTP_NAME_RE.test(entry.name);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <FieldLabel>Tool name</FieldLabel>
        <TextInput
          value={entry.name ?? ""}
          onChange={(v) => onChange({ name: v })}
          placeholder="github_get_user"
        />
        {nameInvalid && (
          <p style={{ margin: "4px 2px 0", fontSize: 11, color: "#dc2626" }}>
            Name must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.
          </p>
        )}
      </div>

      <div>
        <FieldLabel>URL</FieldLabel>
        <TextInput
          value={url}
          onChange={(v) => onChange({ url: v })}
          placeholder="https://api.example.com/users/{userId}?status={status?}"
          mono
        />
        <PlaceholderPreview url={url} pinnedKeys={Object.keys(params)} />
        {optionalInPath && (
          <p style={{ margin: "4px 2px 0", fontSize: 11, color: "#dc2626" }}>
            Optional placeholders ({"{X?}"}) are only allowed in the query string.
          </p>
        )}
      </div>

      <div>
        <FieldLabel>Description</FieldLabel>
        <TextArea
          value={entry.description ?? ""}
          onChange={(v) => onChange({ description: v })}
          placeholder="Looks up a user by ID."
          rows={2}
        />
      </div>

      <HeadersEditor
        headers={headers}
        secrets={catalog.secrets}
        onChange={(next) => onChange({ headers: next })}
      />

      <ParamsEditor
        params={params}
        placeholders={placeholders}
        secrets={catalog.secrets}
        onChange={(next) => onChange({ params: next })}
      />
    </div>
  );
}

function CommaList({
  values,
  onChange,
  placeholder,
  suggestions,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <TextInput
        value={values.join(", ")}
        onChange={(v) =>
          onChange(
            v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder={placeholder}
        mono
      />
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (values.includes(s)) onChange(values.filter((v) => v !== s));
                else onChange([...values, s]);
              }}
              style={{
                padding: "1px 7px",
                borderRadius: 4,
                background: values.includes(s) ? NEUTRAL.ink : "#fff",
                color: values.includes(s) ? "#fff" : NEUTRAL.textMuted,
                border: `1px solid ${values.includes(s) ? NEUTRAL.ink : NEUTRAL.border}`,
                fontFamily: FONT_MONO,
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Spawnable / Skills / Reply ──────────────────────────────────────────

function SpawnableSection({ selected, parsedManifest, catalog, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const raw = Array.isArray(agent.spawnable) ? agent.spawnable : [];

  type Draft = { kind: "ref" | "inline"; agentId?: string };
  const drafts: Draft[] = raw.map((entry): Draft => {
    if (!isRecord(entry)) return { kind: "ref" };
    if (entry.kind === "inline") return { kind: "inline" };
    return { kind: "ref", agentId: asString(entry.agentId) };
  });

  const writeAll = (next: Draft[]) => {
    if (next.length === 0) {
      setField([...selected.agentPath, "spawnable"], undefined);
      return;
    }
    const out: unknown[] = next.map((entry, index) => {
      if (entry.kind === "inline") {
        const existing = raw[index];
        if (isRecord(existing) && existing.kind === "inline") return existing;
        return { kind: "inline", definition: {} };
      }
      const o: Record<string, unknown> = { kind: "ref" };
      if (entry.agentId) o.agentId = entry.agentId;
      return o;
    });
    setField([...selected.agentPath, "spawnable"], out);
  };

  return (
    <Section
      title="SPAWNABLE AGENTS"
      collapsible
      defaultExpanded={drafts.length > 0}
      action={
        <SmallButton label="+ Add" onClick={() => writeAll([...drafts, { kind: "ref" }])} />
      }
    >
      {drafts.length === 0 ? (
        <EmptyHint>No sub-agents this LLM may spawn.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {drafts.map((draft, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "110px minmax(0, 1fr) auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <SelectInput<"ref" | "inline">
                value={draft.kind}
                onChange={(v) => {
                  if (!v) return;
                  const next = [...drafts];
                  next[idx] = { kind: v, agentId: draft.agentId };
                  writeAll(next);
                }}
                options={[
                  { value: "ref", label: "ref" },
                  { value: "inline", label: "inline" },
                ]}
              />
              {draft.kind === "ref" ? (
                <SelectInput<string>
                  value={draft.agentId ?? ""}
                  onChange={(v) => {
                    const next = [...drafts];
                    next[idx] = { ...draft, agentId: v || undefined };
                    writeAll(next);
                  }}
                  options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))}
                  allowEmpty
                  emptyLabel="Select agent…"
                />
              ) : (
                <span
                  style={{
                    padding: "6px 10px",
                    background: "#fff",
                    border: `1px dashed ${NEUTRAL.borderStrong}`,
                    borderRadius: 6,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: NEUTRAL.textMuted,
                  }}
                >
                  Edit inline definition in YAML.
                </span>
              )}
              <SmallButton
                label="✕"
                tone="danger"
                onClick={() => writeAll(drafts.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SkillsSection({ selected, parsedManifest, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const raw = Array.isArray(agent.skills)
    ? agent.skills.filter((s): s is string => typeof s === "string")
    : [];

  const writeAll = (next: string[]) => {
    const filtered = next.map((s) => s.trim()).filter(Boolean);
    setField([...selected.agentPath, "skills"], filtered.length > 0 ? filtered : undefined);
  };

  return (
    <Section title="SKILLS" collapsible defaultExpanded={raw.length > 0}>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: NEUTRAL.textMuted }}>
        Skill names this agent can load mid-run via <code>use_skill</code>. Names must match{" "}
        <code style={{ fontFamily: FONT_MONO }}>^[a-z][a-z0-9-]*$</code>.
      </p>
      <CommaList
        values={raw}
        onChange={writeAll}
        placeholder="research, summarize"
      />
    </Section>
  );
}

function ReplySection({ selected, parsedManifest, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const reply = agent.reply;
  const enabled = reply === true || isRecord(reply);
  const maxPerRun = isRecord(reply) && typeof reply.maxPerRun === "number" ? reply.maxPerRun : undefined;

  return (
    <Section title="REPLY" collapsible defaultExpanded={enabled}>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: NEUTRAL.textMuted }}>
        Register a per-invocation <code>reply</code> tool the model can call to deliver intermediate
        assistant messages mid-run.
      </p>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: FONT_SANS,
          fontSize: 12.5,
          color: NEUTRAL.text,
          marginBottom: 8,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (event.target.checked) {
              setField([...selected.agentPath, "reply"], true);
            } else {
              setField([...selected.agentPath, "reply"], undefined);
            }
          }}
        />
        Enable reply tool
      </label>
      {enabled && (
        <div>
          <FieldLabel>Max replies per run</FieldLabel>
          <NumberField
            value={maxPerRun}
            onChange={(v) => {
              if (v === undefined) setField([...selected.agentPath, "reply"], true);
              else setField([...selected.agentPath, "reply"], { maxPerRun: v });
            }}
            min={1}
            step={1}
            placeholder="unlimited"
          />
        </div>
      )}
    </Section>
  );
}

// ─── Tool-agent / Loop / Output-destination / Output-mapping ─────────────

function ToolCallSection({ selected, parsedManifest, catalog, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const tool = isRecord(agent.tool) ? agent.tool : {};
  const kind = asString(tool.kind) === "mcp" ? "mcp" : "local";
  const server = asString(tool.server) ?? "";
  const name = asString(tool.name) ?? "";
  const params = readStringMap(tool.params) ?? {};

  const writeTool = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = {
      kind: patch.kind !== undefined ? patch.kind : kind,
      name: patch.name !== undefined ? patch.name : name,
    };
    const serverVal = patch.server !== undefined ? patch.server : server;
    const paramsVal = patch.params !== undefined ? patch.params : params;
    if (serverVal) next.server = serverVal;
    if (paramsVal && Object.keys(paramsVal as Record<string, string>).length > 0) {
      next.params = paramsVal;
    }
    setField([...selected.agentPath, "tool"], next);
  };

  return (
    <Section title="TOOL CALL">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
          <div>
            <FieldLabel>Kind</FieldLabel>
            <SelectInput<"local" | "mcp">
              value={kind}
              onChange={(v) => writeTool({ kind: v || "local", server: v === "mcp" ? server : undefined })}
              options={[
                { value: "local", label: "local" },
                { value: "mcp", label: "mcp" },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Tool name</FieldLabel>
            <TextInput
              value={name}
              onChange={(v) => writeTool({ name: v })}
              placeholder="send_slack"
              mono
            />
          </div>
        </div>
        {kind === "mcp" && (
          <div>
            <FieldLabel>Server</FieldLabel>
            <SelectInput<string>
              value={server}
              onChange={(v) => writeTool({ server: v })}
              options={catalog.mcpServers.map((s) => ({ value: s.id, label: s.displayName }))}
              allowEmpty
              emptyLabel="Select server…"
            />
          </div>
        )}
        <KeyValueEditor
          label="Params"
          map={params}
          onChange={(next) => writeTool({ params: next })}
          placeholder={{ key: "channel", value: '"#content" or {{topic}}' }}
        />
      </div>
    </Section>
  );
}

function KeyValueEditor({
  label,
  map,
  onChange,
  placeholder,
}: {
  label: string;
  map: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  placeholder?: { key: string; value: string };
}) {
  const rows = Object.entries(map);
  const setRow = (idx: number, key: string, value: string) => {
    const next: Record<string, string> = {};
    rows.forEach(([k, v], i) => {
      if (i === idx) {
        if (key) next[key] = value;
      } else {
        next[k] = v;
      }
    });
    onChange(next);
  };
  const addRow = () => onChange({ ...map, [`field${rows.length + 1}`]: "" });
  const removeRow = (idx: number) => {
    const next: Record<string, string> = {};
    rows.forEach(([k, v], i) => {
      if (i !== idx) next[k] = v;
    });
    onChange(next);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <FieldLabel>{label}</FieldLabel>
        <SmallButton label="+ Add" onClick={addRow} />
      </div>
      {rows.length === 0 ? (
        <EmptyHint>No params.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(([k, v], idx) => (
            <div
              key={`${idx}-${k}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto",
                gap: 6,
              }}
            >
              <TextInput
                value={k}
                onChange={(nk) => setRow(idx, nk, v)}
                placeholder={placeholder?.key ?? "key"}
                mono
              />
              <TextInput
                value={v}
                onChange={(nv) => setRow(idx, k, nv)}
                placeholder={placeholder?.value ?? "value"}
                mono
              />
              <SmallButton label="✕" tone="danger" onClick={() => removeRow(idx)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LoopSection({ selected, parsedManifest, setField }: InspectorProps) {
  const agent = (getAtPath(parsedManifest, selected.agentPath) as Record<string, unknown>) ?? {};
  const until = asString(agent.until) ?? "";
  const maxIterations =
    typeof agent.maxIterations === "number" ? agent.maxIterations : undefined;
  const enabled = until.length > 0 || maxIterations !== undefined;

  return (
    <Section title="LOOP" collapsible defaultExpanded={enabled}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: FONT_SANS,
          fontSize: 12.5,
          color: NEUTRAL.text,
          marginBottom: 8,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (event.target.checked) {
              setField([...selected.agentPath, "until"], "{{result.approved}} == true");
              setField([...selected.agentPath, "maxIterations"], 3);
            } else {
              setField([...selected.agentPath, "until"], undefined);
              setField([...selected.agentPath, "maxIterations"], undefined);
            }
          }}
        />
        Loop this container until a condition is met
      </label>

      {enabled && (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <FieldLabel>Until expression</FieldLabel>
            <TextInput
              value={until}
              onChange={(v) => setField([...selected.agentPath, "until"], v || undefined)}
              placeholder="{{editor.approved}} == true"
              mono
            />
          </div>
          <div>
            <FieldLabel>Max iterations</FieldLabel>
            <NumberField
              value={maxIterations}
              onChange={(v) => setField([...selected.agentPath, "maxIterations"], v)}
              min={1}
              step={1}
              placeholder="3"
            />
          </div>
        </div>
      )}
    </Section>
  );
}

function OutputDestinationSection({ selected, setField }: InspectorProps) {
  const stateKey = selected.stateKey ?? selected.id;
  // The stateKey override lives on the StepRef; if no override is set, the
  // runner falls back to the agent's own id. We write to the StepRef path so
  // edits don't disturb the inline agent's `id` field.
  return (
    <Section title="OUTPUT DESTINATION" collapsible defaultExpanded={false}>
      <FieldLabel>State key</FieldLabel>
      <TextInput
        value={stateKey}
        onChange={(v) => {
          if (selected.stepPath) {
            setField([...selected.stepPath, "stateKey"], v || undefined);
          } else {
            setField([...selected.agentPath, "stateKey"], v || undefined);
          }
        }}
        placeholder={selected.id}
        mono
      />
      <p style={{ margin: "6px 2px 0", fontFamily: FONT_SANS, fontSize: 11, color: NEUTRAL.textSubtle }}>
        Output lands on parent state as{" "}
        <code style={{ fontFamily: FONT_MONO, color: NEUTRAL.textMuted }}>
          {`{{${stateKey}}}`}
        </code>
        . Following steps can reference this.
      </p>
    </Section>
  );
}

function OutputMappingSection({ parsedManifest, setField }: InspectorProps) {
  const raw = isRecord(parsedManifest.output) ? parsedManifest.output : {};
  const rows = flattenOutput(raw);

  const writeAll = (next: Array<{ key: string; template: string }>) => {
    const out: Record<string, unknown> = {};
    for (const row of next) {
      const path = row.key.split(".").filter(Boolean);
      if (path.length === 0) continue;
      writeDeep(out, path, row.template);
    }
    setField(["output"], Object.keys(out).length > 0 ? out : undefined);
  };

  return (
    <Section
      title="OUTPUT MAPPING"
      collapsible
      defaultExpanded
      action={
        <SmallButton
          label="+ Add"
          onClick={() => writeAll([...rows, { key: "", template: "" }])}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyHint>No output mapping — pipeline returns the final state map.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto",
                gap: 6,
              }}
            >
              <TextInput
                value={row.key}
                onChange={(v) => {
                  const next = [...rows];
                  next[idx] = { ...row, key: v };
                  writeAll(next);
                }}
                placeholder="article"
                mono
              />
              <TextInput
                value={row.template}
                onChange={(v) => {
                  const next = [...rows];
                  next[idx] = { ...row, template: v };
                  writeAll(next);
                }}
                placeholder="{{writing.writer.draft}}"
                mono
              />
              <SmallButton
                label="✕"
                tone="danger"
                onClick={() => writeAll(rows.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function flattenOutput(value: unknown, prefix = ""): Array<{ key: string; template: string }> {
  const out: Array<{ key: string; template: string }> = [];
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push({ key: path, template: v });
    else if (isRecord(v)) out.push(...flattenOutput(v, path));
  }
  return out;
}

function writeDeep(target: Record<string, unknown>, path: string[], value: string) {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!isRecord(cursor[k])) cursor[k] = {};
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px dashed ${NEUTRAL.borderStrong}`,
        background: NEUTRAL.paperBg,
        fontFamily: FONT_SANS,
        fontSize: 11.5,
        color: NEUTRAL.textMuted,
      }}
    >
      {children}
    </div>
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getAtPath(root: unknown, path: PipelinePath): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor == null) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment];
    } else {
      if (!isRecord(cursor)) return undefined;
      cursor = cursor[segment];
    }
  }
  return cursor;
}
