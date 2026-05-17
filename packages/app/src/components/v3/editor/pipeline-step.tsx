// PipelineStep — graph block for an agent. Used both for the root single-LLM
// agent (n=undefined) and for steps inside a pipeline (n=1..N).
//
// When selected, the block expands to show full inputs + outputs lists. When
// not selected, it collapses to a one-line summary so a 3+ step pipeline
// stays scannable.

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { I } from "@/components/v3/icons";
import { Mono, ag } from "@/components/v3/primitives";

export interface StepField {
  name: string;
  type: string;
  required?: boolean;
}

export type StepKind = "llm" | "tool" | "sequential" | "parallel";

export function PipelineStep({
  n,
  id,
  name,
  kind,
  selected,
  summary,
  model,
  inputs,
  outputs,
  onClick,
}: {
  n?: number;
  id: string;
  name: string;
  kind: StepKind;
  selected?: boolean;
  summary?: string;
  model?: string;
  inputs?: StepField[];
  outputs?: StepField[];
  onClick?: (event?: ReactMouseEvent) => void;
}) {
  const palette = kindPalette(kind);
  return (
    <div
      onClick={onClick ? (e) => onClick(e) : undefined}
      style={{
        width: 380,
        background: ag.surface2,
        border: `1.5px solid ${selected ? ag.ink : ag.line}`,
        borderRadius: 5,
        overflow: "hidden",
        boxShadow: selected ? "0 0 0 3px rgba(26,25,22,0.06)" : "none",
        position: "relative",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {/* Step number gutter — skipped when n is undefined (root agent block) */}
      {n != null && (
        <div
          style={{
            position: "absolute",
            left: -18,
            top: 10,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: selected ? ag.ink : ag.surface2,
            border: `1.5px solid ${selected ? ag.ink : ag.line}`,
            color: selected ? ag.surface : ag.muted,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            display: "grid",
            placeItems: "center",
          }}
        >
          {n}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `1px solid ${ag.line2}`,
          background: selected ? ag.surfaceWarm : ag.surface,
        }}
      >
        <KindBadge palette={palette} />
        <div style={{ fontWeight: 500, fontSize: 13, color: ag.ink }}>{name}</div>
        <Mono size={11} color={ag.muted}>
          {id}
        </Mono>
        <div style={{ flex: 1 }} />
        {selected ? (
          <Mono
            size={10.5}
            color={ag.warn}
            style={{ background: ag.warnBg, padding: "1px 6px", borderRadius: 2 }}
          >
            EDITING
          </Mono>
        ) : (
          <I.Ellipsis size={12} style={{ color: ag.muted }} />
        )}
      </div>

      {/* Summary + model */}
      {(summary || model) && (
        <div style={{ padding: "8px 12px 4px" }}>
          {summary && (
            <Mono size={11.5} color={ag.text2}>
              {summary}
            </Mono>
          )}
          {model && (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <I.Sparkle size={10} style={{ color: ag.muted }} />
              <Mono size={10.5} color={ag.muted}>
                {model}
              </Mono>
            </div>
          )}
        </div>
      )}

      {/* Collapsed footer for non-selected steps — counts only */}
      {!selected && (inputs || outputs) && (
        <CollapsedFooter id={id} inputs={inputs} outputs={outputs} />
      )}

      {/* Expanded inputs/outputs for selected steps */}
      {selected && inputs && inputs.length > 0 && <BlockList label="Inputs" items={inputs} />}
      {selected && outputs && outputs.length > 0 && (
        <BlockList label="Outputs" items={outputs} warm refLabel={`{{${id}.*}}`} />
      )}
    </div>
  );
}

function KindBadge({ palette }: { palette: ReturnType<typeof kindPalette> }) {
  return (
    <span
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: "2px 6px",
        borderRadius: 3,
        fontSize: 10.5,
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
      }}
    >
      {palette.label}
    </span>
  );
}

function CollapsedFooter({
  id,
  inputs,
  outputs,
}: {
  id: string;
  inputs?: StepField[];
  outputs?: StepField[];
}) {
  return (
    <div
      style={{
        padding: "6px 12px 8px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderTop: `1px solid ${ag.line2}`,
        background: ag.surface,
      }}
    >
      {inputs && (
        <Mono size={10.5} color={ag.muted}>
          {inputs.length} input{inputs.length === 1 ? "" : "s"}
        </Mono>
      )}
      {inputs && outputs && (
        <Mono size={10.5} color={ag.muted}>
          ·
        </Mono>
      )}
      {outputs && (
        <Mono size={10.5} color={ag.muted}>
          {outputs.length} output{outputs.length === 1 ? "" : "s"}
        </Mono>
      )}
      <div style={{ flex: 1 }} />
      <Mono size={10} color={ag.muted}>
        {`{{${id}.*}}`}
      </Mono>
    </div>
  );
}

function BlockList({
  label,
  items,
  warm,
  refLabel,
}: {
  label: string;
  items: StepField[];
  warm?: boolean;
  refLabel?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderTop: `1px solid ${ag.line2}`,
        background: warm ? ag.surfaceWarm : ag.surface,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Mono
          size={9.5}
          color={ag.muted}
          style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
        >
          {label}
        </Mono>
        {refLabel && (
          <Mono size={10.5} color={ag.muted}>
            · {refLabel}
          </Mono>
        )}
      </div>
      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((item) => (
          <div
            key={item.name}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 8,
              fontSize: 11.5,
            }}
          >
            <Mono size={11.5} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.name}
              {item.required && (
                <span style={{ color: ag.warn, marginLeft: 3, fontSize: 9 }}>•</span>
              )}
            </Mono>
            <Mono
              size={10.5}
              color={ag.text2}
              style={{
                padding: "1px 5px",
                background: ag.bg,
                borderRadius: 2,
                border: `1px solid ${ag.line2}`,
              }}
            >
              {item.type}
            </Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

function kindPalette(kind: StepKind) {
  switch (kind) {
    case "llm":
      return { fg: ag.blue, bg: ag.blueBg, label: "LLM" };
    case "tool":
      return { fg: ag.warn, bg: ag.warnBg, label: "tool" };
    case "sequential":
      return { fg: ag.purple, bg: ag.purpleBg, label: "sequential" };
    case "parallel":
      return { fg: ag.purple, bg: ag.purpleBg, label: "parallel" };
    default:
      return { fg: ag.muted, bg: ag.line2, label: kind };
  }
}
