"use client";

import { PROPERTY_TYPES, type PropertyType } from "@/lib/manifest-catalog";
import { Field, SectionCard, Select, SmallButton, TextInput } from "./form-controls";

export interface OutputFieldDraft {
  key: string;
  type: PropertyType | "";
}

interface OutputSectionProps {
  fields: OutputFieldDraft[];
  onChange: (fields: OutputFieldDraft[]) => void;
}

export function OutputSection({ fields, onChange }: OutputSectionProps) {
  const update = (index: number, patch: Partial<OutputFieldDraft>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const add = () => {
    onChange([...fields, { key: "", type: "string" }]);
  };

  const remove = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <SectionCard
      title="Output schema"
      description="Structured output fields. Leave empty for free-form text."
      actions={<SmallButton label="Add field" onClick={add} />}
    >
      {fields.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
          No output fields.
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={index}
              className="grid items-end gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
            >
              <Field label="Field name">
                <TextInput
                  value={field.key}
                  onChange={(next) => update(index, { key: next })}
                  placeholder="result"
                  mono
                />
              </Field>
              <Field label="Type">
                <Select<PropertyType>
                  value={field.type}
                  allowEmpty
                  emptyLabel="Select…"
                  onChange={(next) => update(index, { type: next })}
                  options={PROPERTY_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </Field>
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
