// PipelineView — V3 editor layout for sequential/parallel manifests. The
// graph shows each step (numbered), a loop badge when relevant, and the
// inspector switches its contents based on the selected step.
//
// Like SingleAgentView, this is largely display + simple inline-edit of the
// selected step's instruction. Heavier wiring (drag-to-reorder, full input
// mapping edit, etc.) is deferred to a follow-up.

"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { I } from "@/components/v3/icons";
import {
  Btn,
  Edge,
  Mono,
  NodeIO,
  Tag,
  ag,
} from "@/components/v3/primitives";
import { GraphPanel, GraphValidates } from "./graph-panel";
import { PipelineStep, type StepField } from "./pipeline-step";
import {
  BindRow,
  DashedAdd,
  Field,
  FooterHint,
  InsSection,
  StateLine,
  SubBlock,
} from "./inspector-bits";
import {
  computeAvailableStateAt,
  nodeFromAgent,
  type PipelineNode,
  type StateRef,
} from "@/components/agent-builder/pipeline-types";

export type PipelineViewMode = "build" | "yaml" | "instruction" | "both";

export function PipelineView({
  rootManifest,
  manifestId,
  view,
  onChangeView,
  onChange,
  yamlPanel,
}: {
  rootManifest: Record<string, unknown>;
  manifestId: string;
  view: PipelineViewMode;
  onChangeView: (v: PipelineViewMode) => void;
  /** Generic patcher — receives a fully-formed next root manifest. Used by
   *  Phase 2+ pipeline editors (root description/model, step add/delete, etc.). */
  onChange?: (next: Record<string, unknown>) => void;
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
            selectedId={selectedId}
            onSelect={setSelectedId}
            flatSteps={flatSteps}
          />
        )}

        {(view === "yaml" || view === "both") && yamlPanel}

        {view !== "yaml" && (
          <PipelineInspector
            root={root}
            selected={selectedNode}
            availableState={availableState.keys}
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

/* ── Graph panel populated with the parsed step tree ───────────────────── */
function PipelineGraph({
  root,
  selectedId,
  onSelect,
  flatSteps,
}: {
  root: PipelineNode;
  selectedId: string;
  onSelect: (id: string) => void;
  flatSteps: PipelineNode[];
}) {
  const children = root.steps ?? root.branches ?? [];
  const inputs = (root.inputSchema ?? []).map((f) => f.key);
  const childIds = children.map((c) => c.id);

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

  return (
    <GraphPanel
      topLeftExtra={loopBadge}
      topRight={
        <>
          <Btn
            variant="secondary"
            size="sm"
            icon={<I.Plus size={11} style={{ marginRight: 5 }} />}
          >
            Add step
          </Btn>
          <Btn variant="secondary" size="sm">
            Layout: vertical
          </Btn>
        </>
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
  availableState,
}: {
  root: PipelineNode;
  selected: PipelineNode;
  availableState: StateRef[];
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
                const binding = wired
                  ? {
                      kind: "var" as const,
                      label: wired.replace(/^\{\{|\}\}$/g, ""),
                    }
                  : selected.id === root.id
                    ? { kind: "caller" as const, label: "from caller" }
                    : { kind: "literal" as const, label: "unbound" };
                return (
                  <BindRow
                    key={f.name}
                    target={f.name}
                    type={f.type}
                    required={f.required}
                    binding={binding}
                    last={i === inputs.length - 1}
                  />
                );
              })
            )}
          </div>
          <DashedAdd>+ Map input</DashedAdd>
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
              click to map →
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

        {/* Folded agent settings */}
        <div style={{ borderTop: `1px solid ${ag.line2}` }}>
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
