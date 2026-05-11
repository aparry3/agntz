"use client";

import type { Catalog } from "@/lib/use-catalog";
import { Field, SectionCard, Select, SmallButton } from "./form-controls";

export interface SpawnableDraft {
  // Inline definitions are kept as opaque strings of YAML — visual editing of
  // nested LLM definitions is out of scope for v1.
  kind: "ref" | "inline";
  agentId?: string;
  inlineYaml?: string;
}

interface SpawnableSectionProps {
  entries: SpawnableDraft[];
  catalog: Catalog;
  onChange: (entries: SpawnableDraft[]) => void;
}

export function SpawnableSection({ entries, catalog, onChange }: SpawnableSectionProps) {
  const update = (index: number, patch: Partial<SpawnableDraft>) => {
    const next = [...entries];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const add = () => {
    onChange([...entries, { kind: "ref" }]);
  };

  const remove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  return (
    <SectionCard
      title="Spawnable agents"
      description="Sub-agents this LLM is allowed to spawn at runtime."
      actions={<SmallButton label="Add" onClick={add} />}
    >
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
          No spawnable agents.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <div
              key={index}
              className="grid items-end gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[160px_minmax(0,1fr)_auto]"
            >
              <Field label="Kind">
                <Select<"ref" | "inline">
                  value={entry.kind}
                  onChange={(next) => {
                    if (next !== "") update(index, { kind: next });
                  }}
                  options={[
                    { value: "ref", label: "ref" },
                    { value: "inline", label: "inline (YAML only)" },
                  ]}
                />
              </Field>

              {entry.kind === "ref" ? (
                <Field label="Agent">
                  <Select<string>
                    value={entry.agentId ?? ""}
                    allowEmpty
                    emptyLabel="Select agent…"
                    onChange={(next) => update(index, { agentId: next || undefined })}
                    options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))}
                  />
                </Field>
              ) : (
                <div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-4 text-xs text-zinc-500">
                  Inline definitions are edited in YAML view.
                </div>
              )}

              <div className="flex justify-end">
                <SmallButton label="Remove" onClick={() => remove(index)} tone="danger" />
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
