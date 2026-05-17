// ToolsEditor — inspector section for an LLM agent's `tools:` array.
//
// Renders each existing entry as a ToolBlock, with per-row controls to
// wrap MCP tools (pin params from state) and edit attached HTTP tools
// (headers, params, name, description). The "+ Add tool source" button
// opens a stepwise picker (kind grid → per-kind sub-picker).

"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentCatalogEntry,
  McpServerCatalogEntry,
  ToolCatalogEntry,
} from "@/lib/use-catalog";
import { I } from "@/components/v3/icons";
import { Btn, Mono, Spinner, ag } from "@/components/v3/primitives";
import { DashedAdd, ToolBlock } from "./inspector-bits";
import { EditableSelect, EditableText, Popover } from "./editable-fields";

/* ── Wire types — match `@agntz/manifest` ManifestToolEntry ────────────── */

/** Per-MCP-tool wrapping (matches `WrappedToolRef`). When `tool` is the only
 *  populated field we serialize back to a plain string in YAML. */
export interface WrappedMcpTool {
  tool: string;
  name?: string;
  description?: string;
  params?: Record<string, string>;
}

export type McpToolRef = string | WrappedMcpTool;

export type ToolEntry =
  | { kind: "mcp"; server: string; tools?: McpToolRef[] }
  | { kind: "local"; tools: string[] }
  | { kind: "agent"; agent: string }
  | {
      kind: "http";
      name: string;
      url: string;
      method?: string;
      headers?: Record<string, string>;
      params?: Record<string, string>;
      description?: string;
    };

interface ToolsEditorProps {
  tools: ToolEntry[];
  onChange: (next: ToolEntry[] | undefined) => void;
  mcpServers: McpServerCatalogEntry[];
  localTools: ToolCatalogEntry[];
  agents: AgentCatalogEntry[];
  loadMcpTools: (serverId: string) => Promise<string[]>;
  mcpToolsByServer: Record<string, string[] | undefined>;
  /** ID of the current agent — excluded from the agent-tool picker so an
   *  agent can't accidentally call itself. */
  currentAgentId?: string;
}

export function ToolsEditor({
  tools,
  onChange,
  mcpServers,
  localTools,
  agents,
  loadMcpTools,
  mcpToolsByServer,
  currentAgentId,
}: ToolsEditorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const commit = (next: ToolEntry[]) => {
    onChange(next.length === 0 ? undefined : next);
  };

  const removeAt = (index: number) => {
    commit(tools.filter((_, i) => i !== index));
  };

  const patchAt = (index: number, next: ToolEntry) => {
    commit(tools.map((t, i) => (i === index ? next : t)));
  };

  const append = (entry: ToolEntry) => {
    commit([...tools, entry]);
    setOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tools.length === 0 ? (
        <Mono size={11} color={ag.muted}>
          No tools attached yet.
        </Mono>
      ) : (
        tools.map((tool, i) => (
          <ToolEntryView
            key={i}
            tool={tool}
            onRemove={() => removeAt(i)}
            onChange={(next) => patchAt(i, next)}
          />
        ))
      )}
      <div>
        <DashedAdd
          onClick={() => setOpen(true)}
          style={{
            position: "relative",
            border: open ? `1px dashed ${ag.ink}` : undefined,
          }}
        >
          <span ref={triggerRef as unknown as React.RefObject<HTMLSpanElement>} style={{ display: "inline-block" }}>
            + Add tool source
          </span>
        </DashedAdd>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={340}>
        <ToolPicker
          mcpServers={mcpServers}
          localTools={localTools}
          agents={agents}
          loadMcpTools={loadMcpTools}
          mcpToolsByServer={mcpToolsByServer}
          currentAgentId={currentAgentId}
          existing={tools}
          onAdd={append}
          onCancel={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}

/* ── Rendering attached tools ──────────────────────────────────────────── */

function ToolEntryView({
  tool,
  onRemove,
  onChange,
}: {
  tool: ToolEntry;
  onRemove: () => void;
  onChange: (next: ToolEntry) => void;
}) {
  switch (tool.kind) {
    case "mcp":
      return (
        <ToolBlock kind="mcp" label="mcp" server={tool.server}>
          <McpToolList
            tools={tool.tools}
            onChange={(nextTools) => onChange({ ...tool, tools: nextTools })}
            onRemoveSource={onRemove}
          />
        </ToolBlock>
      );
    case "local":
      return (
        <ToolBlock kind="local" label="local">
          <SimpleToolList items={tool.tools} onRemoveSource={onRemove} />
        </ToolBlock>
      );
    case "agent":
      return (
        <ToolBlock kind="agent" label="agent" server={tool.agent}>
          <SimpleToolList items={[tool.agent]} onRemoveSource={onRemove} />
        </ToolBlock>
      );
    case "http":
      return (
        <ToolBlock
          kind="http"
          label="http"
          server={`${tool.method ?? "GET"} ${tool.url}`}
        >
          <HttpToolRow
            tool={tool}
            onChange={onChange}
            onRemoveSource={onRemove}
          />
        </ToolBlock>
      );
  }
}

function SimpleToolList({
  items,
  onRemoveSource,
}: {
  items: string[];
  onRemoveSource: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item, i) => (
        <div
          key={`${item}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: `1px solid ${ag.line2}`,
            borderRadius: 3,
            padding: "5px 8px",
            background: ag.surface,
          }}
        >
          <Mono size={11.5}>{item}</Mono>
          {i === items.length - 1 && <RemoveBtn onClick={onRemoveSource} title="Remove source" />}
        </div>
      ))}
    </div>
  );
}

/* ── MCP tool list — per-tool wrap editor ──────────────────────────────── */

function McpToolList({
  tools,
  onChange,
  onRemoveSource,
}: {
  tools: McpToolRef[] | undefined;
  onChange: (next: McpToolRef[] | undefined) => void;
  onRemoveSource: () => void;
}) {
  const list = tools ?? [];

  if (list.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          border: `1px solid ${ag.line2}`,
          borderRadius: 3,
          padding: "5px 8px",
          background: ag.surface,
        }}
      >
        <Mono size={11.5} color={ag.muted}>
          * (all tools)
        </Mono>
        <div style={{ flex: 1 }} />
        <RemoveBtn onClick={onRemoveSource} title="Remove source" />
      </div>
    );
  }

  const patchAt = (idx: number, next: McpToolRef | undefined) => {
    const out = list
      .map((t, i) => (i === idx ? next : t))
      .filter((t): t is McpToolRef => t !== undefined);
    onChange(out.length === 0 ? undefined : out);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {list.map((tool, i) => (
        <McpToolRow
          key={i}
          tool={tool}
          onChange={(next) => patchAt(i, next)}
          onRemoveSource={i === list.length - 1 ? onRemoveSource : undefined}
        />
      ))}
    </div>
  );
}

function McpToolRow({
  tool,
  onChange,
  onRemoveSource,
}: {
  tool: McpToolRef;
  onChange: (next: McpToolRef | undefined) => void;
  onRemoveSource?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const wrapped = typeof tool === "string" ? null : tool;
  const baseName = typeof tool === "string" ? tool : tool.tool;

  const params = wrapped?.params;
  const hasOverrides =
    wrapped !== null && (wrapped.params || wrapped.name || wrapped.description);

  const updateParams = (next: Record<string, string> | undefined) => {
    // Wrap on first edit; unwrap back to a plain string when all overrides
    // are cleared (keeps YAML clean).
    const merged: WrappedMcpTool = { tool: baseName };
    if (wrapped?.name) merged.name = wrapped.name;
    if (wrapped?.description) merged.description = wrapped.description;
    if (next && Object.keys(next).length > 0) merged.params = next;
    if (!merged.name && !merged.description && !merged.params) {
      onChange(baseName);
    } else {
      onChange(merged);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${ag.line2}`,
        borderRadius: 3,
        background: ag.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
        }}
      >
        <Mono size={11.5}>{baseName}</Mono>
        {hasOverrides && (
          <span
            style={{
              background: ag.warnBg,
              color: ag.warn,
              padding: "1px 5px",
              borderRadius: 2,
              fontSize: 9.5,
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
            }}
            title="This tool has param/name overrides applied"
          >
            wrapped
          </span>
        )}
        <div style={{ flex: 1 }} />
        <IconBtn
          onClick={() => setExpanded((o) => !o)}
          title={expanded ? "Hide config" : "Pin params from state"}
          active={expanded}
        >
          {expanded ? <I.Chev size={10} style={{ transform: "rotate(180deg)" }} /> : <I.Sliders size={11} />}
        </IconBtn>
        {onRemoveSource && <RemoveBtn onClick={onRemoveSource} title="Remove source" />}
      </div>
      {expanded && (
        <div
          style={{
            padding: "8px",
            borderTop: `1px solid ${ag.line2}`,
            background: ag.surface2,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <ParamsEditor
            label="Pinned params"
            value={params}
            onChange={updateParams}
            keyPlaceholder="param_name"
            valuePlaceholder="{{state.value}}"
            hint="placeholder → state template"
          />
        </div>
      )}
    </div>
  );
}

/* ── HTTP tool row — inline name/description/headers/params editor ─────── */

function HttpToolRow({
  tool,
  onChange,
  onRemoveSource,
}: {
  tool: Extract<ToolEntry, { kind: "http" }>;
  onChange: (next: ToolEntry) => void;
  onRemoveSource: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const patch = (next: Partial<Extract<ToolEntry, { kind: "http" }>>) => {
    const merged: Record<string, unknown> = { ...tool, ...next };
    for (const k of Object.keys(merged)) {
      if (merged[k] === undefined) delete merged[k];
    }
    onChange(merged as ToolEntry);
  };

  return (
    <div
      style={{
        border: `1px solid ${ag.line2}`,
        borderRadius: 3,
        background: ag.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
        }}
      >
        <Mono size={11.5}>{tool.name}</Mono>
        <div style={{ flex: 1 }} />
        <IconBtn
          onClick={() => setExpanded((o) => !o)}
          title={expanded ? "Hide config" : "Edit HTTP config"}
          active={expanded}
        >
          {expanded ? <I.Chev size={10} style={{ transform: "rotate(180deg)" }} /> : <I.Sliders size={11} />}
        </IconBtn>
        <RemoveBtn onClick={onRemoveSource} title="Remove tool" />
      </div>
      {expanded && (
        <div
          style={{
            padding: "8px",
            borderTop: `1px solid ${ag.line2}`,
            background: ag.surface2,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <EditableText
            label="Name"
            value={tool.name}
            onChange={(v) => patch({ name: v })}
            placeholder="my_tool_name"
            mono
          />
          <EditableText
            label="URL"
            value={tool.url}
            onChange={(v) => patch({ url: v })}
            placeholder="https://api.example.com/things/{id}"
            mono
          />
          <EditableSelect
            label="Method"
            value={tool.method ?? "GET"}
            options={HTTP_METHODS}
            onChange={(v) => patch({ method: v === "GET" ? undefined : v })}
          />
          <EditableText
            label="Description (shown to the model)"
            value={tool.description ?? ""}
            onChange={(v) => patch({ description: v || undefined })}
            placeholder="optional"
            multiline
            rows={2}
          />
          <ParamsEditor
            label="Pinned params"
            value={tool.params}
            onChange={(next) => patch({ params: next })}
            keyPlaceholder="param_name"
            valuePlaceholder="{{state.value}}"
            hint="URL/query placeholders → state templates"
          />
          <ParamsEditor
            label="Headers"
            value={tool.headers}
            onChange={(next) => patch({ headers: next })}
            keyPlaceholder="X-Header-Name"
            valuePlaceholder="{{secrets.token}}"
            hint="values support {{secrets.X}}"
          />
        </div>
      )}
    </div>
  );
}

/* ── Reusable param/header rows editor ─────────────────────────────────── */

/**
 * Editor for a `Record<string, string>` field where keys and values are typed
 * separately. We keep an internal `rows` list (array of [key, value]) so the
 * UI can hold partially-filled rows (e.g. value typed before a key). On every
 * keystroke we commit a sanitized `Record` back upstream — empty keys are
 * skipped, but stay visible in the local list until the user fills them in.
 */
export function ParamsEditor({
  label,
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  hint,
}: {
  label: string;
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  hint?: string;
}) {
  type Row = [string, string];
  const [rows, setRows] = useState<Row[]>(() => Object.entries(value ?? {}));

  // Resync when the upstream value changes from outside (e.g. another inspector
  // edit), but preserve in-progress empty-key rows so the user doesn't lose
  // their place mid-type.
  const upstreamKey = useMemo(
    () => Object.entries(value ?? {}).map(([k, v]) => `${k}=${v}`).join("|"),
    [value],
  );
  const localKey = useMemo(
    () => rows.filter(([k]) => k.trim() !== "").map(([k, v]) => `${k}=${v}`).join("|"),
    [rows],
  );
  useEffect(() => {
    if (upstreamKey === localKey) return;
    const pending = rows.filter(([k]) => k.trim() === "");
    setRows([...Object.entries(value ?? {}), ...pending]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamKey]);

  const commit = (next: Row[]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      const key = k.trim();
      if (!key) continue;
      obj[key] = v;
    }
    onChange(Object.keys(obj).length === 0 ? undefined : obj);
  };

  const updateKey = (idx: number, key: string) =>
    commit(rows.map((r, i): Row => (i === idx ? [key, r[1]] : r)));
  const updateVal = (idx: number, val: string) =>
    commit(rows.map((r, i): Row => (i === idx ? [r[0], val] : r)));
  const removeRow = (idx: number) => commit(rows.filter((_, i) => i !== idx));
  const addRow = () => {
    if (rows.some(([k]) => k === "")) return;
    commit([...rows, ["", ""]]);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: ag.muted,
            fontWeight: 500,
            fontFamily: "var(--font-mono)",
          }}
        >
          {label}
        </div>
        {hint && (
          <Mono size={10} color={ag.muted}>
            · {hint}
          </Mono>
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {rows.map(([k, v], i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) 22px",
                gap: 4,
                alignItems: "center",
              }}
            >
              <input
                value={k}
                onChange={(e) => updateKey(i, e.target.value)}
                placeholder={keyPlaceholder}
                style={paramInputStyle}
              />
              <input
                value={v}
                onChange={(e) => updateVal(i, e.target.value)}
                placeholder={valuePlaceholder}
                style={paramInputStyle}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="Remove"
                style={{
                  border: "1px solid transparent",
                  background: "transparent",
                  color: ag.muted,
                  cursor: "pointer",
                  borderRadius: 3,
                  padding: 2,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                <I.X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        style={{
          padding: "4px 8px",
          border: `1px dashed ${ag.line}`,
          borderRadius: 4,
          background: "transparent",
          color: ag.text2,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        + Add row
      </button>
    </div>
  );
}

const paramInputStyle: CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  border: `1px solid ${ag.line}`,
  borderRadius: 4,
  background: ag.surface,
  color: ag.ink,
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  outline: 0,
  boxSizing: "border-box",
};

/* ── Small per-row controls ────────────────────────────────────────────── */

function RemoveBtn({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        marginLeft: 2,
        width: 20,
        height: 20,
        border: 0,
        background: "transparent",
        color: ag.muted,
        cursor: "pointer",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = ag.line2;
        e.currentTarget.style.color = ag.danger;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = ag.muted;
      }}
    >
      <I.X size={11} />
    </button>
  );
}

function IconBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 20,
        height: 20,
        border: 0,
        background: active ? ag.line2 : "transparent",
        color: active ? ag.ink : ag.muted,
        cursor: "pointer",
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 3,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = ag.line2;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

/* ── Stepwise picker ───────────────────────────────────────────────────── */

type PickerStep = "kind" | "mcp" | "local" | "agent" | "http";

function ToolPicker(props: {
  mcpServers: McpServerCatalogEntry[];
  localTools: ToolCatalogEntry[];
  agents: AgentCatalogEntry[];
  loadMcpTools: (serverId: string) => Promise<string[]>;
  mcpToolsByServer: Record<string, string[] | undefined>;
  currentAgentId?: string;
  existing: ToolEntry[];
  onAdd: (entry: ToolEntry) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<PickerStep>("kind");

  return (
    <div>
      <PickerHeader
        step={step}
        onBack={step === "kind" ? undefined : () => setStep("kind")}
        onClose={props.onCancel}
      />
      {step === "kind" && <KindGrid onPick={setStep} />}
      {step === "mcp" && (
        <MCPSubPicker
          mcpServers={props.mcpServers}
          loadMcpTools={props.loadMcpTools}
          mcpToolsByServer={props.mcpToolsByServer}
          onAdd={props.onAdd}
        />
      )}
      {step === "local" && (
        <LocalSubPicker
          localTools={props.localTools}
          existing={props.existing}
          onAdd={props.onAdd}
        />
      )}
      {step === "agent" && (
        <AgentSubPicker
          agents={props.agents}
          currentAgentId={props.currentAgentId}
          existing={props.existing}
          onAdd={props.onAdd}
        />
      )}
      {step === "http" && <HTTPSubPicker onAdd={props.onAdd} />}
    </div>
  );
}

function PickerHeader({
  step,
  onBack,
  onClose,
}: {
  step: PickerStep;
  onBack?: () => void;
  onClose: () => void;
}) {
  const titles: Record<PickerStep, string> = {
    kind: "Add tool source",
    mcp: "Add MCP tools",
    local: "Add local tools",
    agent: "Call another agent as a tool",
    http: "Add an HTTP endpoint as a tool",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderBottom: `1px solid ${ag.line2}`,
        background: ag.surface,
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          title="Back"
          style={{
            border: 0,
            background: "transparent",
            color: ag.muted,
            cursor: "pointer",
            padding: 2,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <I.ChevR size={12} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}
      <div style={{ fontSize: 12.5, color: ag.ink, fontWeight: 500, flex: 1 }}>{titles[step]}</div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        style={{
          border: 0,
          background: "transparent",
          color: ag.muted,
          cursor: "pointer",
          padding: 2,
        }}
      >
        <I.X size={11} />
      </button>
    </div>
  );
}

function KindGrid({ onPick }: { onPick: (kind: PickerStep) => void }) {
  const options: Array<{ kind: Exclude<PickerStep, "kind">; label: string; sub: string }> = [
    { kind: "mcp", label: "MCP server", sub: "Tools exposed by an MCP server you've connected." },
    { kind: "local", label: "Local tool", sub: "Built-in tools registered with the runner." },
    { kind: "agent", label: "Another agent", sub: "Invoke another saved agent like a tool." },
    { kind: "http", label: "HTTP endpoint", sub: "A GET/POST URL surfaced to the model as a tool." },
  ];
  return (
    <div style={{ padding: 6 }}>
      {options.map((opt) => (
        <button
          key={opt.kind}
          type="button"
          onClick={() => onPick(opt.kind)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            border: 0,
            background: "transparent",
            padding: "8px 10px",
            cursor: "pointer",
            borderRadius: 4,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = ag.surfaceWarm;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <div style={{ fontSize: 13, color: ag.ink, fontWeight: 500 }}>{opt.label}</div>
          <div style={{ fontSize: 11, color: ag.muted, marginTop: 2 }}>{opt.sub}</div>
        </button>
      ))}
    </div>
  );
}

/* ── MCP sub-picker ────────────────────────────────────────────────────── */

function MCPSubPicker({
  mcpServers,
  loadMcpTools,
  mcpToolsByServer,
  onAdd,
}: {
  mcpServers: McpServerCatalogEntry[];
  loadMcpTools: (id: string) => Promise<string[]>;
  mcpToolsByServer: Record<string, string[] | undefined>;
  onAdd: (entry: ToolEntry) => void;
}) {
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedServer) void loadMcpTools(selectedServer);
  }, [selectedServer, loadMcpTools]);

  if (!selectedServer) {
    if (mcpServers.length === 0) {
      return (
        <EmptyHint
          message="No MCP servers connected."
          link={{ href: "/settings/connections", label: "Add a server" }}
        />
      );
    }
    return (
      <div style={{ padding: 6 }}>
        {mcpServers.map((server) => (
          <button
            key={server.id}
            type="button"
            onClick={() => {
              setSelectedServer(server.id);
              setPicked(new Set());
            }}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "7px 10px",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              borderRadius: 4,
              gap: 6,
              fontFamily: "inherit",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = ag.surfaceWarm)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: ag.ink, fontWeight: 500 }}>
                {server.displayName || server.id}
              </div>
              <Mono size={10.5} color={ag.muted}>
                {server.url ?? server.description ?? server.id}
              </Mono>
            </div>
            <I.ChevR size={11} style={{ color: ag.muted }} />
          </button>
        ))}
      </div>
    );
  }

  const availableTools = mcpToolsByServer[selectedServer];
  const loading = availableTools === undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 360 }}>
      <div
        style={{
          padding: "6px 10px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.bg,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedServer(null)}
          style={{
            border: 0,
            background: "transparent",
            color: ag.muted,
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
          }}
        >
          <I.ChevR size={11} style={{ transform: "rotate(180deg)" }} />
        </button>
        <Mono size={11}>{selectedServer}</Mono>
      </div>
      <div style={{ overflow: "auto", padding: 6, flex: 1 }}>
        {loading ? (
          <div
            style={{
              padding: 14,
              textAlign: "center",
              color: ag.muted,
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              justifyContent: "center",
            }}
          >
            <Spinner size={11} /> Loading tools…
          </div>
        ) : availableTools.length === 0 ? (
          <div style={{ padding: 14, textAlign: "center", color: ag.muted, fontSize: 12 }}>
            This server exposes no tools.
          </div>
        ) : (
          availableTools.map((toolName) => {
            const checked = picked.has(toolName);
            return (
              <label
                key={toolName}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  color: ag.ink,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = ag.surfaceWarm)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(toolName);
                    else next.delete(toolName);
                    setPicked(next);
                  }}
                  style={{ margin: 0, cursor: "pointer" }}
                />
                {toolName}
              </label>
            );
          })
        )}
      </div>
      <PickerFooter
        disabled={picked.size === 0}
        primaryLabel={
          picked.size === 0
            ? "Pick at least one"
            : `Attach ${picked.size} tool${picked.size === 1 ? "" : "s"}`
        }
        onPrimary={() => {
          onAdd({ kind: "mcp", server: selectedServer, tools: Array.from(picked) });
        }}
        extraLeft={
          <button
            type="button"
            onClick={() => onAdd({ kind: "mcp", server: selectedServer })}
            title="Attach the server with all tools exposed"
            style={{
              border: `1px solid ${ag.line}`,
              background: ag.surface2,
              color: ag.text2,
              cursor: "pointer",
              borderRadius: 4,
              padding: "4px 9px",
              fontSize: 11.5,
              fontFamily: "inherit",
            }}
          >
            Attach all
          </button>
        }
      />
    </div>
  );
}

/* ── Local sub-picker ──────────────────────────────────────────────────── */

function LocalSubPicker({
  localTools,
  existing,
  onAdd,
}: {
  localTools: ToolCatalogEntry[];
  existing: ToolEntry[];
  onAdd: (entry: ToolEntry) => void;
}) {
  const alreadyAttached = useMemo(() => {
    const set = new Set<string>();
    for (const tool of existing) {
      if (tool.kind === "local") tool.tools.forEach((n) => set.add(n));
    }
    return set;
  }, [existing]);

  const onlyLocal = localTools.filter((t) => t.source === "inline");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (onlyLocal.length === 0) {
    return <EmptyHint message="No local tools registered with the runner." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 360 }}>
      <div style={{ overflow: "auto", padding: 6, flex: 1 }}>
        {onlyLocal.map((tool) => {
          const attached = alreadyAttached.has(tool.name);
          const checked = picked.has(tool.name);
          return (
            <label
              key={tool.name}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "5px 8px",
                borderRadius: 3,
                cursor: attached ? "not-allowed" : "pointer",
                opacity: attached ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!attached) e.currentTarget.style.background = ag.surfaceWarm;
              }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <input
                type="checkbox"
                disabled={attached}
                checked={checked || attached}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(tool.name);
                  else next.delete(tool.name);
                  setPicked(next);
                }}
                style={{ marginTop: 2, cursor: attached ? "not-allowed" : "pointer" }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Mono size={11.5}>{tool.name}</Mono>
                {tool.description && (
                  <div style={{ fontSize: 11, color: ag.muted, marginTop: 1 }}>
                    {tool.description}
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>
      <PickerFooter
        disabled={picked.size === 0}
        primaryLabel={
          picked.size === 0
            ? "Pick at least one"
            : `Attach ${picked.size} tool${picked.size === 1 ? "" : "s"}`
        }
        onPrimary={() => onAdd({ kind: "local", tools: Array.from(picked) })}
      />
    </div>
  );
}

/* ── Agent sub-picker ──────────────────────────────────────────────────── */

function AgentSubPicker({
  agents,
  currentAgentId,
  existing,
  onAdd,
}: {
  agents: AgentCatalogEntry[];
  currentAgentId?: string;
  existing: ToolEntry[];
  onAdd: (entry: ToolEntry) => void;
}) {
  const alreadyAttached = useMemo(() => {
    const set = new Set<string>();
    for (const tool of existing) {
      if (tool.kind === "agent") set.add(tool.agent);
    }
    return set;
  }, [existing]);

  const candidates = agents.filter((a) => a.id !== currentAgentId);

  if (candidates.length === 0) {
    return <EmptyHint message="No other saved agents to call." />;
  }

  return (
    <div style={{ padding: 6, maxHeight: 360, overflow: "auto" }}>
      {candidates.map((agent) => {
        const attached = alreadyAttached.has(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            disabled={attached}
            onClick={() => onAdd({ kind: "agent", agent: agent.id })}
            style={{
              display: "flex",
              alignItems: "flex-start",
              width: "100%",
              padding: "7px 10px",
              border: 0,
              background: "transparent",
              cursor: attached ? "not-allowed" : "pointer",
              borderRadius: 4,
              gap: 6,
              fontFamily: "inherit",
              textAlign: "left",
              opacity: attached ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!attached) e.currentTarget.style.background = ag.surfaceWarm;
            }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: ag.ink, fontWeight: 500 }}>{agent.name}</div>
              <Mono size={10.5} color={ag.muted}>
                {agent.id}
              </Mono>
              {agent.description && (
                <div style={{ fontSize: 11, color: ag.muted, marginTop: 2 }}>{agent.description}</div>
              )}
            </div>
            {attached && (
              <span style={{ fontSize: 10.5, color: ag.muted, fontFamily: "var(--font-mono)" }}>
                attached
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── HTTP sub-picker ───────────────────────────────────────────────────── */

export const HTTP_METHODS = [
  ["GET", "GET"],
  ["POST", "POST"],
  ["PUT", "PUT"],
  ["DELETE", "DELETE"],
  ["PATCH", "PATCH"],
] as const;

function HTTPSubPicker({ onAdd }: { onAdd: (entry: ToolEntry) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<string>("GET");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<Record<string, string> | undefined>();
  const [headers, setHeaders] = useState<Record<string, string> | undefined>();

  const valid = name.trim().length > 0 && /^https?:\/\//.test(url.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 520 }}>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <EditableText
          label="Name"
          value={name}
          onChange={setName}
          placeholder="my_tool_name"
          mono
        />
        <EditableText
          label="URL"
          value={url}
          onChange={setUrl}
          placeholder="https://api.example.com/things/{id}"
          mono
        />
        <EditableSelect
          label="Method"
          value={method}
          options={HTTP_METHODS}
          onChange={setMethod}
        />
        <EditableText
          label="Description (shown to the model)"
          value={description}
          onChange={setDescription}
          placeholder="optional"
          multiline
          rows={2}
        />
        <ParamsEditor
          label="Pinned params"
          value={params}
          onChange={setParams}
          keyPlaceholder="param_name"
          valuePlaceholder="{{state.value}}"
          hint="URL/query placeholders → state templates"
        />
        <ParamsEditor
          label="Headers"
          value={headers}
          onChange={setHeaders}
          keyPlaceholder="X-Header-Name"
          valuePlaceholder="{{secrets.token}}"
          hint="values support {{secrets.X}}"
        />
      </div>
      <PickerFooter
        disabled={!valid}
        primaryLabel="Attach HTTP tool"
        onPrimary={() => {
          if (!valid) return;
          const entry: Extract<ToolEntry, { kind: "http" }> = {
            kind: "http",
            name: name.trim(),
            url: url.trim(),
            method: method === "GET" ? undefined : method,
          };
          if (description.trim()) entry.description = description.trim();
          if (params && Object.keys(params).length > 0) entry.params = params;
          if (headers && Object.keys(headers).length > 0) entry.headers = headers;
          onAdd(entry);
        }}
      />
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function PickerFooter({
  primaryLabel,
  onPrimary,
  disabled,
  extraLeft,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  disabled?: boolean;
  extraLeft?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 8,
        borderTop: `1px solid ${ag.line2}`,
        background: ag.bg,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {extraLeft}
      <div style={{ flex: 1 }} />
      <Btn variant="primary" size="sm" onClick={onPrimary} disabled={disabled}>
        {primaryLabel}
      </Btn>
    </div>
  );
}

function EmptyHint({
  message,
  link,
}: {
  message: string;
  link?: { href: string; label: string };
}) {
  return (
    <div style={{ padding: 18, textAlign: "center" }}>
      <Mono size={11.5} color={ag.muted}>
        {message}
      </Mono>
      {link && (
        <div style={{ marginTop: 8 }}>
          <a
            href={link.href}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: ag.blue,
              textDecoration: "none",
            }}
          >
            {link.label} →
          </a>
        </div>
      )}
    </div>
  );
}
