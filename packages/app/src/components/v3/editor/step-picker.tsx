// StepPicker — popover content for "+ Add step" in the pipeline editor.
//
// Picks one of: inline LLM, inline tool, inline sequential, inline parallel,
// or a reference to a saved agent. Inline kinds get a sensible scaffold so
// the user can keep editing in the inspector immediately.

"use client";

import { useState } from "react";
import type { AgentCatalogEntry } from "@/lib/use-catalog";
import { I } from "@/components/v3/icons";
import { Btn, Mono, ag } from "@/components/v3/primitives";

export type AddStepKind = "llm" | "tool" | "sequential" | "parallel" | "ref";

export interface StepRefPayload {
  ref?: string;
  agent?: Record<string, unknown>;
}

export function StepPicker({
  agents,
  currentAgentId,
  onAdd,
  onCancel,
  nextStepIndex,
}: {
  agents: AgentCatalogEntry[];
  currentAgentId?: string;
  onAdd: (step: StepRefPayload) => void;
  onCancel: () => void;
  /** Index used to generate a default id for inline new steps (e.g. `step_3`). */
  nextStepIndex: number;
}) {
  const [step, setStep] = useState<"kind" | "ref">("kind");

  return (
    <div>
      <PickerHeader
        title={step === "kind" ? "Add step" : "Reference existing agent"}
        onBack={step === "ref" ? () => setStep("kind") : undefined}
        onClose={onCancel}
      />
      {step === "kind" && (
        <KindGrid
          onPick={(kind) => {
            if (kind === "ref") {
              setStep("ref");
              return;
            }
            onAdd({ agent: scaffoldFor(kind, nextStepIndex) });
          }}
        />
      )}
      {step === "ref" && (
        <RefPicker
          agents={agents}
          currentAgentId={currentAgentId}
          onPick={(ref) => onAdd({ ref })}
        />
      )}
    </div>
  );
}

function PickerHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
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
          style={{ border: 0, background: "transparent", color: ag.muted, cursor: "pointer", padding: 2 }}
        >
          <I.ChevR size={12} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}
      <div style={{ fontSize: 12.5, color: ag.ink, fontWeight: 500, flex: 1 }}>{title}</div>
      <button
        type="button"
        onClick={onClose}
        title="Close"
        style={{ border: 0, background: "transparent", color: ag.muted, cursor: "pointer", padding: 2 }}
      >
        <I.X size={11} />
      </button>
    </div>
  );
}

function KindGrid({ onPick }: { onPick: (kind: AddStepKind) => void }) {
  const options: Array<{ kind: AddStepKind; label: string; sub: string }> = [
    { kind: "llm", label: "LLM step (inline)", sub: "A model call defined right here in the pipeline." },
    { kind: "tool", label: "Tool step (inline)", sub: "Call a single tool with templated params." },
    { kind: "sequential", label: "Sequential sub-pipeline", sub: "Nest a sequence of steps inside this one." },
    { kind: "parallel", label: "Parallel sub-pipeline", sub: "Run several branches concurrently." },
    { kind: "ref", label: "Reference existing agent", sub: "Call a saved agent as a step." },
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
          onMouseEnter={(e) => (e.currentTarget.style.background = ag.surfaceWarm)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div style={{ fontSize: 13, color: ag.ink, fontWeight: 500 }}>{opt.label}</div>
          <div style={{ fontSize: 11, color: ag.muted, marginTop: 2 }}>{opt.sub}</div>
        </button>
      ))}
    </div>
  );
}

function RefPicker({
  agents,
  currentAgentId,
  onPick,
}: {
  agents: AgentCatalogEntry[];
  currentAgentId?: string;
  onPick: (ref: string) => void;
}) {
  const candidates = agents.filter((a) => a.id !== currentAgentId);
  if (candidates.length === 0) {
    return (
      <div style={{ padding: 18, textAlign: "center" }}>
        <Mono size={11.5} color={ag.muted}>
          No other saved agents to reference.
        </Mono>
      </div>
    );
  }
  return (
    <div style={{ padding: 6, maxHeight: 360, overflow: "auto" }}>
      {candidates.map((agent) => (
        <button
          key={agent.id}
          type="button"
          onClick={() => onPick(agent.id)}
          style={{
            display: "flex",
            alignItems: "flex-start",
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
            <div style={{ fontSize: 12.5, color: ag.ink, fontWeight: 500 }}>{agent.name}</div>
            <Mono size={10.5} color={ag.muted}>
              {agent.id}
            </Mono>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Scaffolds for each inline step kind ───────────────────────────────── */

function scaffoldFor(kind: Exclude<AddStepKind, "ref">, nextStepIndex: number): Record<string, unknown> {
  const id = `step_${nextStepIndex}`;
  switch (kind) {
    case "llm":
      return {
        id,
        kind: "llm",
        model: { provider: "openai", name: "gpt-5.4" },
        instruction: "Describe what this step should do.",
      };
    case "tool":
      return {
        id,
        kind: "tool",
        tool: { kind: "local", name: "tool_name_here" },
      };
    case "sequential":
      return {
        id,
        kind: "sequential",
        steps: [],
      };
    case "parallel":
      return {
        id,
        kind: "parallel",
        branches: [],
      };
  }
}
