// SchemaEditor — editable inputs/outputs schema. Each row has a name input,
// a type dropdown, an optional required toggle (inputs only), and a remove
// button. The "+ Add field" affordance appends a new row.
//
// The wire format mirrors the manifest:
//   { name: "string" }                  → required string (short form)
//   { name: { type: "string", ... } }   → object form (used when optional or
//                                         when extra props like enum/min/max
//                                         are present; preserved verbatim).

"use client";

import { useMemo } from "react";
import { I } from "@/components/v3/icons";
import { Mono, ag } from "@/components/v3/primitives";
import { DashedAdd } from "./inspector-bits";

const TYPE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["string", "string"],
  ["number", "number"],
  ["boolean", "boolean"],
  ["object", "object"],
  ["array", "array"],
];

interface SchemaRow {
  name: string;
  type: string;
  /** Inputs only: when true the field is required (no `default` in raw). */
  required: boolean;
  /** Verbatim raw `default` value (preserved on edit). undefined = no default set. */
  defaultValue?: unknown;
  /** Verbatim extras (enum/min/max/etc.) that we don't expose in the simple editor. */
  extras: Record<string, unknown>;
}

export function SchemaEditor({
  kind,
  schema,
  onChange,
  addLabel,
  emptyMessage,
}: {
  kind: "input" | "output";
  schema: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown> | undefined) => void;
  addLabel?: string;
  emptyMessage?: string;
}) {
  const rows = useMemo(() => parseRows(schema), [schema]);
  const showRequired = kind === "input";

  const commitRows = (next: SchemaRow[]) => {
    onChange(next.length === 0 ? undefined : serializeRows(next));
  };

  const updateRow = (index: number, patch: Partial<SchemaRow>) => {
    const next = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    commitRows(next);
  };

  const removeRow = (index: number) => {
    commitRows(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    const name = nextAvailableName(rows);
    commitRows([...rows, { name, type: "string", required: true, extras: {} }]);
  };

  return (
    <div>
      <div
        style={{
          border: `1px solid ${ag.line}`,
          borderRadius: 4,
          background: ag.surface2,
          overflow: "hidden",
        }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11.5, color: ag.muted, textAlign: "center" }}>
            {emptyMessage ?? `No ${kind} fields declared.`}
          </div>
        ) : (
          rows.map((row, i) => {
            const dupe = rows.findIndex((r, j) => j !== i && r.name === row.name) !== -1;
            return (
              <SchemaRowView
                key={i}
                row={row}
                showRequired={showRequired}
                duplicate={dupe}
                last={i === rows.length - 1}
                onChange={(patch) => updateRow(i, patch)}
                onRemove={() => removeRow(i)}
              />
            );
          })
        )}
      </div>
      <DashedAdd onClick={addRow}>{addLabel ?? `+ Add ${kind}`}</DashedAdd>
    </div>
  );
}

function SchemaRowView({
  row,
  showRequired,
  duplicate,
  last,
  onChange,
  onRemove,
}: {
  row: SchemaRow;
  showRequired: boolean;
  duplicate: boolean;
  last: boolean;
  onChange: (patch: Partial<SchemaRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showRequired
          ? "minmax(0, 1.4fr) 100px auto 22px"
          : "minmax(0, 1.6fr) 110px 22px",
        gap: 6,
        alignItems: "center",
        padding: "6px 10px",
        borderBottom: last ? "0" : `1px solid ${ag.line2}`,
      }}
    >
      <input
        type="text"
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        spellCheck={false}
        style={{
          border: `1px solid ${duplicate ? ag.warn : ag.line2}`,
          borderRadius: 3,
          padding: "3px 6px",
          background: duplicate ? ag.warnBg : ag.surface,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: ag.ink,
          outline: "none",
        }}
        title={duplicate ? "Duplicate field name" : undefined}
      />
      <div
        style={{
          position: "relative",
          border: `1px solid ${ag.line2}`,
          borderRadius: 3,
          background: ag.surface,
        }}
      >
        <select
          value={isKnownType(row.type) ? row.type : "string"}
          onChange={(e) => onChange({ type: e.target.value })}
          style={{
            width: "100%",
            border: 0,
            background: "transparent",
            padding: "3px 24px 3px 6px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: ag.ink,
            outline: "none",
            appearance: "none",
            cursor: "pointer",
          }}
        >
          {TYPE_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <I.Chev
          size={9}
          style={{ position: "absolute", right: 6, top: 7, color: ag.muted, pointerEvents: "none" }}
        />
      </div>
      {showRequired && (
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10.5,
            color: ag.text2,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title={row.required ? "Required" : "Optional"}
        >
          <input
            type="checkbox"
            checked={row.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            style={{ margin: 0, cursor: "pointer" }}
          />
          required
        </label>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove field"
        style={{
          width: 22,
          height: 22,
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
    </div>
  );
}

/* ── Parse / serialize helpers ──────────────────────────────────────────── */

function parseRows(schema: Record<string, unknown> | undefined): SchemaRow[] {
  if (!schema) return [];
  return Object.entries(schema).map(([name, def]) => {
    if (typeof def === "string") {
      return { name, type: def, required: true, extras: {} };
    }
    if (def && typeof def === "object") {
      const obj = def as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "string";
      const hasDefault = Object.prototype.hasOwnProperty.call(obj, "default");
      const defaultValue = hasDefault ? obj.default : undefined;
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "type" || k === "default") continue;
        extras[k] = v;
      }
      return { name, type, required: !hasDefault, defaultValue, extras };
    }
    return { name, type: "string", required: true, extras: {} };
  });
}

function serializeRows(rows: SchemaRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const extrasEmpty = Object.keys(row.extras).length === 0;

    if (row.required && extrasEmpty) {
      out[row.name] = row.type;
      continue;
    }
    const obj: Record<string, unknown> = { type: row.type, ...row.extras };
    if (!row.required) {
      // Preserve any previous default; if the field never had one, emit null so
      // the manifest validator still treats it as optional.
      obj.default = row.defaultValue ?? null;
    }
    out[row.name] = obj;
  }
  return out;
}

function isKnownType(type: string): boolean {
  return TYPE_OPTIONS.some(([v]) => v === type);
}

function nextAvailableName(rows: SchemaRow[]): string {
  const existing = new Set(rows.map((r) => r.name));
  let i = 1;
  while (existing.has(`field_${i}`)) i++;
  return `field_${i}`;
}
