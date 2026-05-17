// ExamplesEditor — input/output pairs the LLM is shown as canonical examples.
// Each pair is a small card with two textareas + remove button.

"use client";

import { I } from "@/components/v3/icons";
import { Mono, ag } from "@/components/v3/primitives";
import { DashedAdd } from "./inspector-bits";

export interface Example {
  input: string;
  output: string;
}

export function ExamplesEditor({
  examples,
  onChange,
}: {
  examples: Example[];
  onChange: (next: Example[] | undefined) => void;
}) {
  const commit = (next: Example[]) => {
    onChange(next.length === 0 ? undefined : next);
  };

  const updateAt = (index: number, patch: Partial<Example>) => {
    commit(examples.map((ex, i) => (i === index ? { ...ex, ...patch } : ex)));
  };

  const removeAt = (index: number) => {
    commit(examples.filter((_, i) => i !== index));
  };

  const add = () => {
    commit([...examples, { input: "", output: "" }]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {examples.length === 0 ? (
        <Mono size={11} color={ag.muted}>
          No examples yet.
        </Mono>
      ) : (
        examples.map((ex, i) => (
          <ExampleCard
            key={i}
            index={i}
            example={ex}
            onChange={(patch) => updateAt(i, patch)}
            onRemove={() => removeAt(i)}
          />
        ))
      )}
      <DashedAdd onClick={add}>+ Add example</DashedAdd>
    </div>
  );
}

function ExampleCard({
  index,
  example,
  onChange,
  onRemove,
}: {
  index: number;
  example: Example;
  onChange: (patch: Partial<Example>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${ag.line}`,
        borderRadius: 4,
        background: ag.surface2,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "5px 10px",
          background: ag.surface,
          borderBottom: `1px solid ${ag.line2}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Mono size={10.5} color={ag.text2} style={{ fontWeight: 500 }}>
          #{index + 1}
        </Mono>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onRemove}
          title="Remove example"
          style={{
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
          <I.X size={10} />
        </button>
      </div>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <ExampleField
          label="Input"
          value={example.input}
          onChange={(input) => onChange({ input })}
        />
        <ExampleField
          label="Output"
          value={example.output}
          onChange={(output) => onChange({ output })}
        />
      </div>
    </div>
  );
}

function ExampleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <Mono
        size={10}
        color={ag.muted}
        style={{ textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3 }}
      >
        {label}
      </Mono>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        spellCheck={false}
        style={{
          display: "block",
          width: "100%",
          border: `1px solid ${ag.line2}`,
          borderRadius: 3,
          padding: "5px 7px",
          background: ag.surface,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.5,
          color: ag.ink,
          resize: "vertical",
          minHeight: 38,
          outline: "none",
        }}
      />
    </div>
  );
}
