"use client";

import type { Catalog } from "@/lib/use-catalog";
import { Field, NumberInput, SectionCard, Select, TextInput } from "./form-controls";

interface ModelSectionProps {
  provider: string;
  name: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  catalog: Catalog;
  onChange: (next: {
    provider: string;
    name: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  }) => void;
}

export function ModelSection({
  provider,
  name,
  temperature,
  maxTokens,
  topP,
  catalog,
  onChange,
}: ModelSectionProps) {
  const providerOption = catalog.providers.find((p) => p.id === provider);
  const models = providerOption?.models ?? [];

  const update = (patch: Partial<ModelSectionProps>) => {
    onChange({
      provider: patch.provider ?? provider,
      name: patch.name ?? name,
      temperature: patch.temperature !== undefined ? patch.temperature : temperature,
      maxTokens: patch.maxTokens !== undefined ? patch.maxTokens : maxTokens,
      topP: patch.topP !== undefined ? patch.topP : topP,
    });
  };

  return (
    <SectionCard
      title="Model"
      description="LLM provider and generation settings."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Provider"
          hint={
            providerOption && !providerOption.configured
              ? "This provider is not yet configured in settings."
              : undefined
          }
        >
          <Select<string>
            value={provider}
            allowEmpty
            emptyLabel="Select a provider…"
            onChange={(next) => update({ provider: next })}
            options={catalog.providers.map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.configured ? undefined : "not configured",
            }))}
          />
        </Field>

        <Field label="Model" hint={models.length === 0 ? "Free-text model name." : undefined}>
          {models.length > 0 ? (
            <Select<string>
              value={models.includes(name) ? name : ""}
              allowEmpty
              emptyLabel={name || "Select a model…"}
              onChange={(next) => update({ name: next })}
              options={models.map((m) => ({ value: m, label: m }))}
            />
          ) : (
            <TextInput
              value={name}
              onChange={(next) => update({ name: next })}
              placeholder="model name"
              mono
            />
          )}
        </Field>

        <Field label="Temperature" hint="0–2. Higher = more random.">
          <NumberInput
            value={temperature}
            onChange={(next) => update({ temperature: next })}
            min={0}
            max={2}
            step={0.1}
            placeholder="0.7"
          />
        </Field>

        <Field label="Max tokens">
          <NumberInput
            value={maxTokens}
            onChange={(next) => update({ maxTokens: next })}
            min={1}
            step={64}
            placeholder="auto"
          />
        </Field>

        <Field label="Top P">
          <NumberInput
            value={topP}
            onChange={(next) => update({ topP: next })}
            min={0}
            max={1}
            step={0.05}
            placeholder="1.0"
          />
        </Field>
      </div>
    </SectionCard>
  );
}
