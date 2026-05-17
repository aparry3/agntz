"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { I } from "@/components/v3/icons";
import { Btn, Label, Mono, Tag, ag } from "@/components/v3/primitives";
import { EditorShell } from "@/components/v3/editor/editor-shell";
import { Field, InsSection, ToolBlock, ToolRow } from "@/components/v3/editor/inspector-bits";

export type ToolRef =
  | { type: "inline"; name: string }
  | { type: "mcp"; server: string; tools?: string[] }
  | { type: "agent"; agentId: string };

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  tools: ToolRef[];
}

interface SkillEditorProps {
  breadcrumb: Array<string | ReactNode>;
  initial: SkillDraft;
  /** When true, name input is disabled (edit existing skill). */
  lockName?: boolean;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (draft: SkillDraft) => Promise<{ error?: string } | void>;
  /** Optional delete action — when provided, shown as a danger button in the secondary actions row. */
  onDelete?: () => void;
  /** Optional metadata used in the header chip line ("v2 · saved 8m ago · 2 tools attached"). */
  metaInfo?: {
    version?: string;
    updatedAt?: string;
  };
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
type ViewMode = "build" | "yaml" | "preview";

export function SkillEditor({
  breadcrumb,
  initial,
  lockName = false,
  submitLabel,
  submittingLabel,
  onSubmit,
  onDelete,
  metaInfo,
}: SkillEditorProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [tools, setTools] = useState<ToolRef[]>(initial.tools);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("build");

  const dirty =
    name !== initial.name ||
    description !== initial.description ||
    instructions !== initial.instructions ||
    JSON.stringify(tools) !== JSON.stringify(initial.tools);

  const titleDisplay = humanize(name) || "Untitled Skill";
  const wordCount = useMemo(
    () => instructions.trim().split(/\s+/).filter(Boolean).length,
    [instructions],
  );
  const tokenEstimate = Math.max(1, Math.round((instructions.length + description.length) / 4));

  const validate = (): string | null => {
    if (!NAME_RE.test(name)) {
      return "Name must be lowercase-kebab-case (e.g. 'my-skill').";
    }
    if (description.trim() === "") return "Description is required.";
    if (instructions.trim() === "") return "Instructions are required.";
    for (let i = 0; i < tools.length; i++) {
      const t = tools[i];
      if (t.type === "inline" && !t.name.trim()) return `Tool #${i + 1}: name required.`;
      if (t.type === "mcp" && !t.server.trim()) return `Tool #${i + 1}: server required.`;
      if (t.type === "agent" && !t.agentId.trim()) return `Tool #${i + 1}: agentId required.`;
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await onSubmit({ name, description, instructions, tools });
    if (result && "error" in result && result.error) setError(result.error);
    setSubmitting(false);
  };

  const metaRight = (
    <>
      <Tag bg={ag.warnBg} color={ag.warn} mono>
        skill
      </Tag>
      <Tag bg={ag.okBg} color={ag.ok}>
        <I.Dot size={6} color={ag.ok} />
        Ready
      </Tag>
      {(metaInfo?.version || metaInfo?.updatedAt || tools.length > 0) && (
        <Mono size={11} color={ag.muted}>
          {[
            metaInfo?.version,
            metaInfo?.updatedAt ? `saved ${metaInfo.updatedAt}` : null,
            tools.length > 0 ? `${tools.length} tool${tools.length === 1 ? "" : "s"} attached` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Mono>
      )}
    </>
  );

  return (
    <EditorShell
      breadcrumb={breadcrumb}
      title={titleDisplay}
      manifestId={name || "untitled-skill"}
      kindTag={null}
      statusTag={null}
      metaRight={metaRight}
      dirty={dirty}
      saving={submitting}
      saveLabel={submitLabel}
      saveLabelDirty={submitLabel}
      onSave={handleSubmit}
      secondaryActions={
        <>
          {onDelete && (
            <Btn
              variant="secondary"
              icon={<I.X size={11} style={{ marginRight: 6 }} />}
              onClick={onDelete}
              style={{ color: ag.danger, borderColor: ag.line }}
            >
              Delete
            </Btn>
          )}
          <Btn variant="secondary" icon={<I.Hist size={12} style={{ marginRight: 6 }} />}>
            History
          </Btn>
          <Btn variant="secondary" icon={<I.Code size={11} style={{ marginRight: 6 }} />}>
            YAML
          </Btn>
        </>
      }
    >
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
        <Label>View</Label>
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
              ["build", "Build", I.Sliders],
              ["yaml", "YAML", I.Code],
              ["preview", "Preview", I.Eye],
            ] as Array<[ViewMode, string, typeof I.Sliders]>
          ).map(([key, label, Ic]) => {
            const on = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                style={{
                  padding: "5px 11px",
                  borderRadius: 3,
                  fontSize: 12,
                  background: on ? ag.bg : "transparent",
                  color: on ? ag.ink : ag.text2,
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
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <Mono size={11} color={ag.muted}>
          ~{tokenEstimate} tokens when loaded
        </Mono>
      </div>

      {/* Body */}
      {view === "build" ? (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 400px",
            minHeight: 0,
          }}
        >
          <InstructionsPanel
            name={name}
            lockName={lockName}
            onNameChange={setName}
            description={description}
            onDescriptionChange={setDescription}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            wordCount={wordCount}
            error={error}
          />
          <Inspector
            name={name}
            tools={tools}
            metaInfo={metaInfo}
            onToolsChange={setTools}
          />
        </div>
      ) : view === "yaml" ? (
        <PlaceholderView label="YAML view" hint="A raw YAML view of this skill will live here." />
      ) : (
        <PlaceholderView
          label="Preview"
          hint="Coming soon: a side-by-side view of what the LLM sees when this skill is in scope vs. after use_skill resolves."
        />
      )}
    </EditorShell>
  );
}

function PlaceholderView({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        background: ag.bg,
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: "24px 28px",
          border: `1px dashed ${ag.line}`,
          borderRadius: 6,
          background: ag.surface2,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: ag.ink,
            marginBottom: 6,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 12, color: ag.muted, lineHeight: 1.5 }}>{hint}</div>
      </div>
    </div>
  );
}

function InstructionsPanel({
  name,
  lockName,
  onNameChange,
  description,
  onDescriptionChange,
  instructions,
  onInstructionsChange,
  wordCount,
  error,
}: {
  name: string;
  lockName: boolean;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  instructions: string;
  onInstructionsChange: (v: string) => void;
  wordCount: number;
  error: string | null;
}) {
  return (
    <div
      style={{
        overflow: "auto",
        padding: "24px 32px 32px",
        background: ag.bg,
        borderRight: `1px solid ${ag.line2}`,
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {error && (
          <div
            style={{
              marginBottom: 18,
              border: `1px solid ${ag.danger}`,
              borderRadius: 4,
              padding: "8px 12px",
              fontSize: 12.5,
              color: ag.danger,
              background: ag.warnBg,
            }}
          >
            {error}
          </div>
        )}

        {/* Name — only shown when creating */}
        {!lockName && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Label>Name</Label>
              <Mono size={10} color={ag.muted}>
                · lowercase-kebab-case, unique per workspace
              </Mono>
            </div>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="my-skill"
              style={inputStyle({ mono: true })}
            />
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Label>Description</Label>
            <Mono size={10} color={ag.muted}>
              · what the LLM sees before loading
            </Mono>
          </div>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="A concise pitch for whether the model should load this skill."
            rows={3}
            style={{ ...inputStyle({}), resize: "vertical", minHeight: 72 }}
          />
        </div>

        {/* Instructions */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Label>Instructions</Label>
            <Mono size={10} color={ag.muted}>
              · returned as the use_skill result when the LLM loads
            </Mono>
            <div style={{ flex: 1 }} />
            <Mono size={10} color={ag.muted}>
              markdown
            </Mono>
          </div>
          <div
            style={{
              border: `1px solid ${ag.line}`,
              borderRadius: 5,
              background: ag.surface2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "5px 10px",
                borderBottom: `1px solid ${ag.line2}`,
                background: ag.surface,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {(["H1", "H2", "B", "I", "•", "1.", "</>"] as const).map((t, i) => (
                <button
                  key={i}
                  type="button"
                  style={{
                    padding: "3px 8px",
                    border: 0,
                    background: "transparent",
                    fontFamily: i >= 5 ? "var(--font-mono)" : "inherit",
                    fontSize: 11,
                    color: ag.text2,
                    cursor: "pointer",
                    borderRadius: 3,
                    fontStyle: t === "I" ? "italic" : "normal",
                    fontWeight: t === "B" || t.startsWith("H") ? 600 : 400,
                  }}
                >
                  {t}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <Mono size={10} color={ag.muted}>
                {wordCount} word{wordCount === 1 ? "" : "s"}
              </Mono>
            </div>
            <textarea
              value={instructions}
              onChange={(e) => onInstructionsChange(e.target.value)}
              placeholder={`When the user asks about X:\n1. Do Y with the lookup_X tool.\n2. If conditions match, take action.`}
              rows={14}
              style={{
                width: "100%",
                padding: "16px 18px 22px",
                border: 0,
                outline: 0,
                background: ag.surface2,
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                lineHeight: 1.7,
                color: ag.ink,
                resize: "vertical",
                minHeight: 280,
              }}
            />
          </div>
        </div>

        {/* "How agents will see this" preview */}
        <div style={{ marginTop: 26 }}>
          <Label style={{ marginBottom: 8 }}>How agents will see this</Label>
          <div
            style={{
              border: `1px dashed ${ag.line}`,
              borderRadius: 4,
              background: ag.surface2,
              padding: "12px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: ag.text2,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
            }}
          >
            <span style={{ color: ag.muted }}>
              {`// injected into the system prompt of any agent declaring this skill`}
            </span>
            {`\nAvailable skills (call `}
            <span style={{ color: ag.ink, fontWeight: 500 }}>use_skill</span>
            {` to load):\n  - `}
            <span style={{ color: ag.warn, fontWeight: 500 }}>{name || "skill-name"}</span>
            {`: ${description || "(no description yet)"}`}
          </div>
          <Mono size={10.5} color={ag.muted} style={{ marginTop: 4, display: "inline-block" }}>
            Token cost only counts when the LLM opts in — until then, only the name + description are visible.
          </Mono>
        </div>
      </div>
    </div>
  );
}

function Inspector({
  name,
  tools,
  metaInfo,
  onToolsChange,
}: {
  name: string;
  tools: ToolRef[];
  metaInfo?: { version?: string; updatedAt?: string };
  onToolsChange: (next: ToolRef[]) => void;
}) {
  const display = humanize(name) || "Untitled Skill";

  const updateTool = (idx: number, next: ToolRef) => {
    onToolsChange(tools.map((t, i) => (i === idx ? next : t)));
  };
  const removeTool = (idx: number) => {
    onToolsChange(tools.filter((_, i) => i !== idx));
  };
  const addTool = (kind: ToolRef["type"]) => {
    const blank: ToolRef =
      kind === "inline"
        ? { type: "inline", name: "" }
        : kind === "mcp"
        ? { type: "mcp", server: "", tools: [] }
        : { type: "agent", agentId: "" };
    onToolsChange([...tools, blank]);
  };

  return (
    <aside
      style={{
        background: ag.surface,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: ag.muted,
            fontSize: 11,
            marginBottom: 4,
          }}
        >
          <Mono size={10.5} color={ag.muted}>
            skill definition
          </Mono>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag bg={ag.warnBg} color={ag.warn} mono>
            skill
          </Tag>
          <div style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>{display}</div>
          <Mono size={10.5} color={ag.muted}>
            {name || "untitled-skill"}
          </Mono>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <InsSection title="Identity" defaultOpen>
          <Field
            label="Name"
            value={name || "—"}
            mono
            hint="lowercase-kebab-case · unique per workspace"
          />
          <Field label="Display name" value={display} />
        </InsSection>

        <InsSection
          title="Tools"
          badge={
            tools.length > 0
              ? `${tools.length} attached · loaded with skill`
              : "0 attached"
          }
          defaultOpen
        >
          {tools.length === 0 ? (
            <div
              style={{
                fontSize: 11.5,
                color: ag.muted,
                padding: "8px 10px",
                background: ag.bg,
                border: `1px dashed ${ag.line}`,
                borderRadius: 4,
                textAlign: "center",
              }}
            >
              No tools yet. Add inline, MCP, or agent refs to expose them when the skill loads.
            </div>
          ) : (
            tools.map((tool, i) => (
              <EditableToolBlock
                key={i}
                tool={tool}
                onChange={(next) => updateTool(i, next)}
                onRemove={() => removeTool(i)}
              />
            ))
          )}
          <AddToolMenu onAdd={addTool} />
          <div
            style={{
              fontSize: 11,
              color: ag.muted,
              padding: "6px 8px",
              background: ag.bg,
              border: `1px dashed ${ag.line}`,
              borderRadius: 4,
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
            }}
          >
            <I.Sparkle size={11} style={{ color: ag.muted, marginTop: 1, flex: "0 0 auto" }} />
            <span>
              These tools are registered into the live tool registry when the agent calls{" "}
              <Mono size={10.5} color={ag.text2}>
                use_skill(&apos;{name || "skill-name"}&apos;)
              </Mono>
              . Already-registered tools are no-ops on re-add.
            </span>
          </div>
        </InsSection>

        <InsSection title="Metadata">
          <Field label="Owner" value="—" mono />
          <Field label="Tags" value="—" mono />
        </InsSection>

        <InsSection title="Advanced">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field inline label="Updated" value={metaInfo?.updatedAt ?? "—"} mono />
            <Field inline label="Version" value={metaInfo?.version ?? "—"} mono />
          </div>
          <Field inline label="Visibility" value="workspace" mono select />
        </InsSection>
      </div>

      {/* Footer hint */}
      <div
        style={{
          flex: "0 0 auto",
          padding: "8px 16px",
          borderTop: `1px solid ${ag.line}`,
          background: ag.bg,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10.5,
          color: ag.muted,
          fontFamily: "var(--font-mono)",
        }}
      >
        <I.Sparkle size={10} />
        Skills are static — no inputs / no state / no template vars.
      </div>
    </aside>
  );
}

function EditableToolBlock({
  tool,
  onChange,
  onRemove,
}: {
  tool: ToolRef;
  onChange: (t: ToolRef) => void;
  onRemove: () => void;
}) {
  const kindMeta = {
    inline: { kind: "local" as const, label: "local" },
    mcp: { kind: "mcp" as const, label: "MCP" },
    agent: { kind: "agent" as const, label: "agent" },
  }[tool.type];

  const headerRight = (
    <button
      type="button"
      onClick={onRemove}
      title="Remove tool"
      style={{
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 3,
        color: ag.muted,
        padding: "2px 4px",
        cursor: "pointer",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <I.X size={11} />
    </button>
  );

  return (
    <div style={{ border: `1px solid ${ag.line}`, borderRadius: 4, background: ag.surface2 }}>
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.surface,
        }}
      >
        <span
          style={{
            background:
              kindMeta.kind === "mcp"
                ? ag.purpleBg
                : kindMeta.kind === "agent"
                ? ag.okBg
                : ag.blueBg,
            color:
              kindMeta.kind === "mcp"
                ? ag.purple
                : kindMeta.kind === "agent"
                ? ag.ok
                : ag.blue,
            padding: "2px 6px",
            borderRadius: 3,
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
          }}
        >
          {kindMeta.label}
        </span>
        <div style={{ flex: 1 }} />
        {headerRight}
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {tool.type === "inline" && (
          <input
            value={tool.name}
            onChange={(e) => onChange({ type: "inline", name: e.target.value })}
            placeholder="tool-name"
            style={inputStyle({ mono: true, small: true })}
          />
        )}
        {tool.type === "mcp" && (
          <>
            <input
              value={tool.server}
              onChange={(e) =>
                onChange({ type: "mcp", server: e.target.value, tools: tool.tools })
              }
              placeholder="server-name or https://mcp.example.com/sse"
              style={inputStyle({ mono: true, small: true })}
            />
            <input
              value={(tool.tools ?? []).join(", ")}
              onChange={(e) =>
                onChange({
                  type: "mcp",
                  server: tool.server,
                  tools: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="tool1, tool2 (optional, blank = all)"
              style={inputStyle({ mono: true, small: true })}
            />
          </>
        )}
        {tool.type === "agent" && (
          <input
            value={tool.agentId}
            onChange={(e) => onChange({ type: "agent", agentId: e.target.value })}
            placeholder="agent-id"
            style={inputStyle({ mono: true, small: true })}
          />
        )}
      </div>
    </div>
  );
}

function AddToolMenu({ onAdd }: { onAdd: (kind: ToolRef["type"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        style={{
          marginTop: 4,
          padding: "6px 10px",
          width: "100%",
          border: `1px dashed ${ag.line}`,
          borderRadius: 4,
          background: "transparent",
          color: ag.text2,
          fontSize: 11.5,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        + Add tool source
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: ag.surface2,
            border: `1px solid ${ag.line}`,
            borderRadius: 4,
            marginTop: 2,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 4px 12px rgba(26,25,22,0.08)",
          }}
        >
          {(
            [
              ["inline", "Inline / local tool"],
              ["mcp", "MCP server"],
              ["agent", "Agent as tool"],
            ] as Array<[ToolRef["type"], string]>
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onAdd(kind);
                setOpen(false);
              }}
              style={{
                padding: "6px 10px",
                border: 0,
                background: "transparent",
                textAlign: "left",
                fontSize: 12,
                color: ag.ink,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function inputStyle({ mono = false, small = false }: { mono?: boolean; small?: boolean } = {}): CSSProperties {
  return {
    width: "100%",
    padding: small ? "5px 8px" : "7px 10px",
    border: `1px solid ${ag.line}`,
    borderRadius: 4,
    background: ag.surface2,
    color: ag.ink,
    fontFamily: mono ? "var(--font-mono)" : "inherit",
    fontSize: small ? 12 : 13,
    outline: 0,
    boxSizing: "border-box",
  };
}

function humanize(slug: string): string {
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Re-exports so consumers can read these without pulling from inspector-bits.
// Avoids unused-import warnings when extending the editor.
export { ToolBlock, ToolRow };
