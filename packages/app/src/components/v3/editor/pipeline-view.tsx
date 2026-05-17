// PipelineView — V3 editor layout for sequential/parallel manifests. The
// graph shows each step (numbered), a loop badge when relevant, and the
// inspector switches its contents based on the selected step.
//
// Phase 5 added step add/remove/move at the root level and interactive
// input-map chips for child steps. Deeper-nested steps still navigate-only
// and require YAML for structural edits.

"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { I } from "@/components/v3/icons";
import {
  Btn,
  Edge,
  Mono,
  NodeIO,
  Tag,
  VarHl,
  ag,
} from "@/components/v3/primitives";
import type { Catalog } from "@/lib/use-catalog";
import { GraphPanel, GraphValidates } from "./graph-panel";
import { PipelineStep, type StepField } from "./pipeline-step";
import { Field, FooterHint, InsSection, StateLine, SubBlock } from "./inspector-bits";
import {
  computeAvailableStateAt,
  nodeFromAgent,
  type PipelineNode,
  type PipelinePath,
  type StateRef,
} from "@/components/agent-builder/pipeline-types";
import {
  appendStepAtRoot,
  containerKeyForKind,
  moveStepAt,
  patchAgentAt,
  patchStepInputMap,
  removeStepAt,
  type RootManifest,
} from "./pipeline-mutations";
import { EditableNumber, EditableText } from "./editable-fields";
import { ModelPicker } from "./model-picker";
import { SchemaEditor } from "./schema-editor";
import { ExamplesEditor, type Example } from "./examples-editor";
import { ToolsEditor, type ToolEntry } from "./tools-editor";
import { getIn, isRecord } from "@/components/agent-builder/pipeline-types";
import { Popover } from "./editable-fields";
import { StepPicker, type StepRefPayload } from "./step-picker";

export type PipelineViewMode = "build" | "yaml" | "instruction" | "both";

export function PipelineView({
  rootManifest,
  manifestId,
  view,
  onChangeView,
  onChange,
  catalog,
  yamlPanel,
}: {
  rootManifest: Record<string, unknown>;
  manifestId: string;
  view: PipelineViewMode;
  onChangeView: (v: PipelineViewMode) => void;
  /** Generic patcher — receives a fully-formed next root manifest. Used by
   *  Phase 2+ pipeline editors (root description/model, step add/delete, etc.). */
  onChange?: (next: Record<string, unknown>) => void;
  /** Workspace catalog — passed to the step picker for agent references. */
  catalog?: Catalog;
  yamlPanel?: ReactNode;
}) {
  const root = useMemo<PipelineNode>(
    () => nodeFromAgent(rootManifest, [], { isRoot: true }),
    [rootManifest]
  );

  // Default selection: the first child step, or root if there are none.
  const firstStep = (root.steps ?? root.branches ?? [])[0];
  const [selectedId, setSelectedId] = useState<string>(firstStep?.id ?? root.id);

  const flatSteps = useMemo(() => flatten(root), [root]);
  const selectedNode = flatSteps.find((n) => n.id === selectedId) ?? root;
  const availableState = useMemo(
    () => computeAvailableStateAt(root, selectedNode.id),
    [root, selectedNode.id]
  );

  const handleAddStep = (payload: StepRefPayload) => {
    if (!onChange) return;
    const next = appendStepAtRoot(rootManifest as RootManifest, payload as Record<string, unknown>);
    onChange(next);
  };

  const handleRemoveSelected = () => {
    if (!onChange || !selectedNode.stepPath) return;
    const next = removeStepAt(rootManifest as RootManifest, selectedNode.stepPath);
    onChange(next);
    setSelectedId(root.id);
  };

  const handleMoveSelected = (delta: -1 | 1) => {
    if (!onChange || !selectedNode.stepPath) return;
    const next = moveStepAt(rootManifest as RootManifest, selectedNode.stepPath, delta);
    onChange(next);
  };

  const handleInputMap = (stepPath: PipelinePath, key: string, value: string | undefined) => {
    if (!onChange) return;
    const next = patchStepInputMap(rootManifest as RootManifest, stepPath, key, value);
    onChange(next);
  };

  const handlePatchAgent = (agentPath: PipelinePath, partial: Record<string, unknown>) => {
    if (!onChange) return;
    const next = patchAgentAt(rootManifest as RootManifest, agentPath, partial);
    onChange(next);
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
              onClick={() => onChangeView(key as PipelineViewMode)}
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
          editing {selectedNode.id === root.id ? "root" : `step · ${selectedNode.id}`}
        </Mono>
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns:
            view === "yaml" ? "1fr" : view === "both" ? "1fr 1fr 420px" : "1fr 420px",
          minHeight: 0,
        }}
      >
        {(view === "build" || view === "instruction" || view === "both") && (
          <PipelineGraph
            root={root}
            rootManifest={rootManifest}
            selectedId={selectedId}
            onSelect={setSelectedId}
            flatSteps={flatSteps}
            catalog={catalog}
            onAddStep={handleAddStep}
          />
        )}

        {(view === "yaml" || view === "both") && yamlPanel}

        {view !== "yaml" && (
          <PipelineInspector
            root={root}
            selected={selectedNode}
            rootManifest={rootManifest}
            catalog={catalog}
            availableState={availableState.keys}
            onRemoveSelected={onChange && selectedNode.stepPath ? handleRemoveSelected : undefined}
            onMoveSelected={onChange && selectedNode.stepPath ? handleMoveSelected : undefined}
            onPatchInputMap={onChange ? handleInputMap : undefined}
            onPatchAgent={onChange ? handlePatchAgent : undefined}
            canMoveUp={canMove(rootManifest, selectedNode, -1)}
            canMoveDown={canMove(rootManifest, selectedNode, 1)}
          />
        )}
      </div>
    </div>
  );
}

function flatten(node: PipelineNode): PipelineNode[] {
  const out: PipelineNode[] = [node];
  const children = node.steps ?? node.branches ?? [];
  for (const c of children) out.push(...flatten(c));
  return out;
}

function canMove(rootManifest: Record<string, unknown>, node: PipelineNode, delta: -1 | 1): boolean {
  if (!node.stepPath || node.stepPath.length === 0) return false;
  const lastSeg = node.stepPath[node.stepPath.length - 1];
  if (typeof lastSeg !== "number") return false;
  const containerKey = node.stepPath.length === 2 ? containerKeyForKind(rootManifest.kind) : null;
  // We only support moving within the root container in this round. Nested
  // steps fall through and disable the arrows.
  if (!containerKey) return false;
  const container = rootManifest[containerKey];
  if (!Array.isArray(container)) return false;
  const newIdx = lastSeg + delta;
  return newIdx >= 0 && newIdx < container.length;
}

/* ── Graph panel populated with the parsed step tree ───────────────────── */
function PipelineGraph({
  root,
  rootManifest,
  selectedId,
  onSelect,
  flatSteps,
  catalog,
  onAddStep,
}: {
  root: PipelineNode;
  rootManifest: Record<string, unknown>;
  selectedId: string;
  onSelect: (id: string) => void;
  flatSteps: PipelineNode[];
  catalog?: Catalog;
  onAddStep: (step: StepRefPayload) => void;
}) {
  const children = root.steps ?? root.branches ?? [];
  const inputs = (root.inputSchema ?? []).map((f) => f.key);
  const childIds = children.map((c) => c.id);

  const addRef = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loopBadge = root.isLoop && root.loop?.until ? (
    <div
      style={{
        padding: "3px 8px",
        border: `1px solid ${ag.line}`,
        borderRadius: 4,
        background: ag.surface2,
        fontSize: 11,
        color: ag.text2,
        fontFamily: "var(--font-mono)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <I.Hist size={11} />
      loop until {root.loop.until}
      {root.loop.maxIterations ? ` · max ${root.loop.maxIterations}` : ""}
    </div>
  ) : null;

  const containerKey = containerKeyForKind(rootManifest.kind);
  const nextStepIndex = (rootManifest[containerKey] as unknown[] | undefined)?.length ?? 0;

  return (
    <GraphPanel
      topLeftExtra={loopBadge}
      topRight={
        <Btn
          ref={addRef}
          variant="secondary"
          size="sm"
          icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
          onClick={() => setAddOpen((o) => !o)}
        >
          Add step
        </Btn>
      }
      status={
        <>
          <GraphValidates />
          <Mono size={11}>
            {flatSteps.length - 1} step{flatSteps.length - 1 === 1 ? "" : "s"} · click any step to edit
          </Mono>
        </>
      }
    >
      <NodeIO label="INPUT" sub={inputs.join(" · ") || "—"} />
      <Edge />
      {children.length === 0 ? (
        <PipelineStep
          n={undefined}
          id={root.id}
          name={root.name}
          kind="llm"
          selected
          summary={root.description}
        />
      ) : (
        children.map((step, i) => (
          <StepWithEdge
            key={step.id}
            step={step}
            n={i + 1}
            selected={step.id === selectedId}
            onSelect={() => onSelect(step.id)}
          />
        ))
      )}
      <NodeIO label="OUTPUT" sub={childIds.length ? `composed from ${childIds.join(" · ")}` : "—"} />
      <Popover open={addOpen} onClose={() => setAddOpen(false)} anchorRef={addRef} width={320}>
        <StepPicker
          agents={catalog?.agents ?? []}
          currentAgentId={typeof rootManifest.id === "string" ? rootManifest.id : undefined}
          nextStepIndex={nextStepIndex + 1}
          onCancel={() => setAddOpen(false)}
          onAdd={(payload) => {
            onAddStep(payload);
            setAddOpen(false);
          }}
        />
      </Popover>
    </GraphPanel>
  );
}

function StepWithEdge({
  step,
  n,
  selected,
  onSelect,
}: {
  step: PipelineNode;
  n: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const inputs: StepField[] = (step.inputSchema ?? []).map((f) => ({
    name: f.key,
    type: f.type,
    required: !f.nullable && f.default === undefined,
  }));
  const outputs: StepField[] = (step.outputSchemaKeys ?? []).map((f) => ({
    name: f.key,
    type: f.type,
  }));
  return (
    <>
      <PipelineStep
        n={n}
        id={step.id}
        name={step.name}
        kind={step.kind === "tool" ? "tool" : step.kind === "sequential" ? "sequential" : step.kind === "parallel" ? "parallel" : "llm"}
        selected={selected}
        summary={step.description ?? step.instructionPreview}
        model={step.model ? `${step.model.provider} · ${step.model.name}` : undefined}
        inputs={inputs.length ? inputs : undefined}
        outputs={outputs.length ? outputs : undefined}
        onClick={onSelect}
      />
      <Edge />
    </>
  );
}

/* ── Pipeline inspector for the selected step ──────────────────────────── */
function PipelineInspector({
  root,
  selected,
  rootManifest,
  catalog,
  availableState,
  onRemoveSelected,
  onMoveSelected,
  onPatchInputMap,
  onPatchAgent,
  canMoveUp,
  canMoveDown,
}: {
  root: PipelineNode;
  selected: PipelineNode;
  rootManifest: Record<string, unknown>;
  catalog?: Catalog;
  availableState: StateRef[];
  onRemoveSelected?: () => void;
  onMoveSelected?: (delta: -1 | 1) => void;
  onPatchInputMap?: (stepPath: PipelinePath, key: string, value: string | undefined) => void;
  onPatchAgent?: (agentPath: PipelinePath, partial: Record<string, unknown>) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const inputs = (selected.inputSchema ?? []).map((f) => ({
    name: f.key,
    type: f.type,
    required: !f.nullable && f.default === undefined,
  }));
  const inputMap = selected.inputMap ?? {};

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
      <div
        style={{
          padding: "11px 16px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.surface,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <Mono size={10.5} color={ag.muted}>
            {root.id}
          </Mono>
          {selected.id !== root.id && (
            <>
              <I.ChevR size={9} />
              <Mono size={10.5} color={ag.muted}>
                {selected.id === root.id ? "root" : "step"}
              </Mono>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag bg={ag.blueBg} color={ag.blue} mono>
            {selected.kind === "llm" ? "LLM" : selected.kind}
          </Tag>
          <div style={{ fontWeight: 500, fontSize: 14, flex: 1 }}>{selected.name}</div>
          <Mono size={10.5} color={ag.muted}>
            {selected.id}
          </Mono>
        </div>
        {selected.id !== root.id && (onRemoveSelected || onMoveSelected) && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
            <StepHeaderBtn
              title="Move step up"
              disabled={!canMoveUp}
              onClick={() => onMoveSelected?.(-1)}
            >
              <I.Chev size={11} style={{ transform: "rotate(180deg)" }} />
            </StepHeaderBtn>
            <StepHeaderBtn
              title="Move step down"
              disabled={!canMoveDown}
              onClick={() => onMoveSelected?.(1)}
            >
              <I.Chev size={11} />
            </StepHeaderBtn>
            <div style={{ flex: 1 }} />
            {onRemoveSelected && (
              <button
                type="button"
                onClick={onRemoveSelected}
                title="Remove step"
                style={{
                  border: `1px solid ${ag.line}`,
                  background: ag.surface2,
                  color: ag.danger,
                  cursor: "pointer",
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <I.X size={10} />
                Remove
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Input mapping */}
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
              {selected.id === root.id ? "Inputs" : "Input mapping"}
            </div>
            <div style={{ fontSize: 11.5, color: ag.muted, marginTop: 4 }}>
              {selected.id === root.id
                ? "The pipeline's inputs. Each one is bound from the caller."
                : `Pipeline state → ${selected.name}'s declared inputs.`}
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
                No inputs declared on this step.
              </div>
            ) : (
              inputs.map((f, i) => {
                const wired = inputMap[f.name];
                const isRoot = selected.id === root.id;
                return (
                  <PipelineBindRow
                    key={f.name}
                    target={f.name}
                    type={f.type}
                    required={f.required}
                    wired={wired}
                    isRoot={isRoot}
                    availableState={availableState}
                    last={i === inputs.length - 1}
                    onBind={
                      onPatchInputMap && !isRoot && selected.stepPath
                        ? (value) => onPatchInputMap(selected.stepPath!, f.name, value)
                        : undefined
                    }
                  />
                );
              })
            )}
          </div>
          {selected.id !== root.id && (
            <Mono size={10.5} color={ag.muted} style={{ marginTop: 6, display: "inline-block" }}>
              Click any binding chip to wire it to upstream state.
            </Mono>
          )}
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
              click a chip above →
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
            {availableState.length === 0 ? (
              <div style={{ padding: 8, fontSize: 11, color: ag.muted, textAlign: "center" }}>
                Nothing in scope.
              </div>
            ) : (
              availableState.map((s, i) => (
                <StateLine
                  key={s.key}
                  name={s.key}
                  type={s.type}
                  origin={s.source === "input" ? "input" : "upstream"}
                  last={i === availableState.length - 1}
                />
              ))
            )}
          </div>
        </div>

        {/* Agent settings — editable when the selected step is an LLM and we
            have a patch callback. Falls back to a read-only summary for
            non-LLM steps (tool / sub-pipeline) since those edits aren't wired
            here yet. */}
        <div style={{ borderTop: `1px solid ${ag.line2}` }}>
          {selected.kind === "llm" && onPatchAgent ? (
            <LLMStepEditor
              agentPath={selected.agentPath}
              rootManifest={rootManifest}
              catalog={catalog}
              onPatchAgent={onPatchAgent}
              currentAgentId={selected.id}
              outputSchemaCount={selected.outputSchemaKeys?.length ?? 0}
            />
          ) : (
            <InsSection
              title="Agent settings"
              badge={selected.kind === "llm" ? "model · instruction" : selected.kind}
              defaultOpen
            >
              {selected.description && (
                <SubBlock label="Description" value={selected.description} multiline />
              )}
              {selected.model && (
                <SubBlock
                  label="Model"
                  value={`${selected.model.provider} · ${selected.model.name}`}
                  mono
                  select
                />
              )}
              {selected.instructionPreview && (
                <SubBlock label="Instruction" value={selected.instructionPreview} mono multiline />
              )}
              {selected.outputSchemaKeys && selected.outputSchemaKeys.length > 0 && (
                <SubBlock
                  label={`Output schema · ${selected.outputSchemaKeys.length} field${selected.outputSchemaKeys.length === 1 ? "" : "s"}`}
                  value={selected.outputSchemaKeys.map((k) => `${k.key}: ${k.type}`).join(", ")}
                  mono
                />
              )}
            </InsSection>
          )}

          {selected.stepPath && (
            <InsSection title="Step config" badge="state key · when">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Field
                  inline
                  label="State key"
                  value={selected.stateKey ?? selected.id}
                  mono
                  hint={`output as {{${selected.stateKey ?? selected.id}}}`}
                />
                <Field inline label="When" value="—" mono hint="always runs" />
              </div>
            </InsSection>
          )}
        </div>
      </div>

      <FooterHint>
        {selected.id === root.id
          ? `Templates can reference the ${inputs.length} pipeline input${inputs.length === 1 ? "" : "s"} above.`
          : `Templates & tools inside ${selected.name} can only use its ${inputs.length} mapped input${inputs.length === 1 ? "" : "s"}.`}
      </FooterHint>
    </aside>
  );
}

function StepHeaderBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: `1px solid ${ag.line}`,
        background: ag.surface2,
        color: disabled ? ag.muted : ag.text2,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        borderRadius: 4,
        width: 22,
        height: 22,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

/* ── Interactive input-mapping row for the pipeline inspector ──────────── */

function PipelineBindRow({
  target,
  type,
  required,
  wired,
  isRoot,
  availableState,
  last,
  onBind,
}: {
  target: string;
  type: string;
  required?: boolean;
  wired: string | undefined;
  isRoot: boolean;
  availableState: StateRef[];
  last?: boolean;
  onBind?: (value: string | undefined) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const interactive = !!onBind && !isRoot;
  const chip = wired
    ? { label: wired.replace(/^\{\{|\}\}$/g, ""), bg: ag.warnBg, fg: ag.warn, isVar: true }
    : isRoot
      ? { label: "from caller", bg: ag.line2, fg: ag.text2, isVar: false }
      : { label: "unbound", bg: ag.bg, fg: ag.text2, isVar: false };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(80px, 1fr) auto 1fr",
        padding: "7px 10px",
        gap: 8,
        alignItems: "center",
        fontSize: 12,
        borderBottom: last ? "0" : `1px solid ${ag.line2}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <Mono size={12}>{target}</Mono>
        {required && (
          <span title="required" style={{ color: ag.warn, fontSize: 10 }}>
            •
          </span>
        )}
        <Mono size={10.5} color={ag.muted}>
          {type}
        </Mono>
      </div>
      <I.ArrowR size={11} style={{ color: ag.muted, transform: "rotate(180deg)" }} />
      <button
        ref={triggerRef}
        type="button"
        disabled={!interactive}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "2px 6px",
          background: chip.bg,
          border: "1px solid transparent",
          borderRadius: 3,
          cursor: interactive ? "pointer" : "default",
          minWidth: 0,
          overflow: "hidden",
          fontFamily: "inherit",
          opacity: interactive ? 1 : 0.85,
        }}
      >
        {chip.isVar ? (
          <VarHl>
            <Mono size={11}>{chip.label}</Mono>
          </VarHl>
        ) : (
          <Mono
            size={10.5}
            color={chip.fg}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}
          >
            {chip.label}
          </Mono>
        )}
        {interactive && (
          <I.Chev size={9} style={{ color: chip.fg, marginLeft: "auto", flex: "0 0 auto", opacity: 0.7 }} />
        )}
      </button>
      {interactive && (
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={260}>
          <div style={{ padding: 6 }}>
            <div style={{ padding: "4px 8px 6px", fontSize: 10.5, color: ag.muted, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Available state
            </div>
            {availableState.length === 0 ? (
              <div style={{ padding: 10, fontSize: 11.5, color: ag.muted, textAlign: "center" }}>
                Nothing in scope yet.
              </div>
            ) : (
              availableState.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    onBind?.(`{{${s.key}}}`);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    borderRadius: 3,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: ag.ink,
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = ag.surfaceWarm)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ background: ag.warnBg, color: ag.warn, borderRadius: 2, padding: "0 4px" }}>
                    {`{{${s.key}}}`}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Mono size={10} color={ag.muted}>
                    {s.type}
                  </Mono>
                </button>
              ))
            )}
            {wired && (
              <>
                <div style={{ height: 1, background: ag.line2, margin: "6px 4px" }} />
                <button
                  type="button"
                  onClick={() => {
                    onBind?.(undefined);
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "5px 8px",
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                    borderRadius: 3,
                    fontSize: 11.5,
                    color: ag.danger,
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = ag.surfaceWarm)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Unbind
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ── LLMStepEditor — editable Agent settings / Tools / Output / Examples
 *    for a kind=llm step. Reads the live agent record from rootManifest at
 *    `agentPath` and writes back via onPatchAgent. */
function LLMStepEditor({
  agentPath,
  rootManifest,
  catalog,
  onPatchAgent,
  currentAgentId,
  outputSchemaCount,
}: {
  agentPath: PipelinePath;
  rootManifest: Record<string, unknown>;
  catalog?: Catalog;
  onPatchAgent: (agentPath: PipelinePath, partial: Record<string, unknown>) => void;
  currentAgentId: string;
  outputSchemaCount: number;
}) {
  const liveAgent = (() => {
    const raw = getIn(rootManifest, agentPath);
    return isRecord(raw) ? raw : {};
  })();

  const description = (liveAgent.description as string | undefined) ?? "";
  const model = (liveAgent.model as Record<string, unknown> | undefined) ?? {};
  const instruction = (liveAgent.instruction as string | undefined) ?? "";
  const tools = (liveAgent.tools as Array<Record<string, unknown>> | undefined) ?? [];
  const outputSchema = liveAgent.outputSchema as Record<string, unknown> | undefined;
  const examples = (liveAgent.examples as Example[] | undefined) ?? [];

  const patch = (partial: Record<string, unknown>) => onPatchAgent(agentPath, partial);
  const patchModel = (next: Partial<Record<string, unknown>>) => {
    const merged: Record<string, unknown> = { ...model };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    patch({ model: Object.keys(merged).length === 0 ? undefined : merged });
  };

  return (
    <>
      <InsSection title="Agent settings" badge="model · instruction" defaultOpen>
        <EditableText
          label="Description"
          value={description}
          onChange={(v) => patch({ description: v || undefined })}
          placeholder="What does this step do?"
          multiline
          rows={2}
        />
        <ModelPicker
          value={{
            provider: (model.provider as string | undefined) ?? "",
            name: (model.name as string | undefined) ?? "",
          }}
          providers={catalog?.providers ?? []}
          loading={catalog?.loading}
          onChange={(next) => patchModel({ provider: next.provider, name: next.name })}
        />
        <EditableText
          label="Instruction"
          value={instruction}
          onChange={(v) => patch({ instruction: v || undefined })}
          placeholder="Step's system prompt. Use {{var}} for inputs."
          multiline
          rows={6}
          mono
        />
      </InsSection>

      <InsSection title="Tools" badge={`${tools.length} attached`}>
        <ToolsEditor
          tools={tools as ToolEntry[]}
          onChange={(next) => patch({ tools: next as Array<Record<string, unknown>> | undefined })}
          mcpServers={catalog?.mcpServers ?? []}
          localTools={catalog?.tools ?? []}
          agents={catalog?.agents ?? []}
          loadMcpTools={catalog?.loadMcpTools ?? (async () => [])}
          mcpToolsByServer={catalog?.mcpToolsByServer ?? {}}
          currentAgentId={currentAgentId}
        />
      </InsSection>

      <InsSection
        title="Output schema"
        badge={`${outputSchemaCount} field${outputSchemaCount === 1 ? "" : "s"}`}
      >
        <SchemaEditor
          kind="output"
          schema={outputSchema}
          onChange={(next) => patch({ outputSchema: next })}
        />
      </InsSection>

      <InsSection title="Examples" badge={`${examples.length} pinned`}>
        <ExamplesEditor
          examples={examples}
          onChange={(next) => patch({ examples: next?.length ? next : undefined })}
        />
      </InsSection>

      <InsSection title="Advanced">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <EditableNumber
            label="Temperature"
            value={typeof model.temperature === "number" ? model.temperature : undefined}
            onChange={(v) => patchModel({ temperature: v })}
            min={0}
            max={2}
            step={0.1}
            placeholder="—"
            hint="0–2, blank = provider default"
          />
          <EditableNumber
            label="Max tokens"
            value={typeof model.maxTokens === "number" ? model.maxTokens : undefined}
            onChange={(v) => patchModel({ maxTokens: v })}
            min={1}
            step={1}
            placeholder="—"
          />
        </div>
      </InsSection>
    </>
  );
}

