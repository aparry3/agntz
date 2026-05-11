"use client";

import { useMemo } from "react";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import type { Catalog } from "@/lib/use-catalog";
import { AGENT_KINDS, type AgentKindOption, type PropertyType } from "@/lib/manifest-catalog";
import { IdentitySection } from "./identity-section";
import { InstructionSection } from "./instruction-section";
import { ModelSection } from "./model-section";
import { ToolsSection, type ToolEntryDraft } from "./tools-section";
import { SpawnableSection, type SpawnableDraft } from "./spawnable-section";
import { OutputSection, type OutputFieldDraft } from "./output-section";

interface AgentBuilderProps {
  manifest: string;
  onChange: (next: string) => void;
  catalog: Catalog;
  idLocked: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toolEntriesFromManifest(manifest: Record<string, unknown>): ToolEntryDraft[] {
  const raw = manifest.tools;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): ToolEntryDraft => {
    if (!isRecord(entry)) return { kind: "", tools: [] };
    const kind = entry.kind;
    if (kind === "local") {
      const tools = Array.isArray(entry.tools) ? entry.tools.filter((t): t is string => typeof t === "string") : [];
      return { kind: "local", tools };
    }
    if (kind === "mcp") {
      const server = typeof entry.server === "string" ? entry.server : undefined;
      const tools = Array.isArray(entry.tools)
        ? entry.tools
            .map((t) => (typeof t === "string" ? t : isRecord(t) && typeof t.tool === "string" ? t.tool : null))
            .filter((t): t is string => t !== null)
        : [];
      return { kind: "mcp", tools, server };
    }
    if (kind === "agent") {
      const agent = typeof entry.agent === "string" ? entry.agent : undefined;
      return { kind: "agent", tools: [], agent };
    }
    return { kind: "", tools: [] };
  });
}

function toolEntriesToManifest(entries: ToolEntryDraft[]): unknown[] {
  return entries
    .filter((e) => e.kind !== "")
    .map((entry) => {
      if (entry.kind === "local") return { kind: "local", tools: entry.tools };
      if (entry.kind === "mcp") {
        const out: Record<string, unknown> = { kind: "mcp" };
        if (entry.server) out.server = entry.server;
        if (entry.tools.length > 0) out.tools = entry.tools;
        return out;
      }
      if (entry.kind === "agent") {
        const out: Record<string, unknown> = { kind: "agent" };
        if (entry.agent) out.agent = entry.agent;
        return out;
      }
      return {};
    });
}

function spawnableFromManifest(manifest: Record<string, unknown>): SpawnableDraft[] {
  const raw = manifest.spawnable;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): SpawnableDraft => {
    if (!isRecord(entry)) return { kind: "ref" };
    if (entry.kind === "inline") {
      return { kind: "inline", inlineYaml: undefined };
    }
    return {
      kind: "ref",
      agentId: typeof entry.agentId === "string" ? entry.agentId : undefined,
    };
  });
}

function spawnableToManifest(entries: SpawnableDraft[], previous: unknown): unknown[] {
  const prevArr = Array.isArray(previous) ? previous : [];
  return entries.map((entry, index) => {
    if (entry.kind === "inline") {
      // Preserve the existing inline definition if there was one at this index.
      const existing = prevArr[index];
      if (isRecord(existing) && existing.kind === "inline") return existing;
      return { kind: "inline", definition: {} };
    }
    const out: Record<string, unknown> = { kind: "ref" };
    if (entry.agentId) out.agentId = entry.agentId;
    return out;
  });
}

function outputFieldsFromManifest(manifest: Record<string, unknown>): OutputFieldDraft[] {
  const raw = manifest.outputSchema;
  if (!isRecord(raw)) return [];
  return Object.entries(raw).map(([key, value]) => {
    let type: PropertyType | "" = "";
    if (typeof value === "string") {
      type = (value as PropertyType) ?? "";
    } else if (isRecord(value) && typeof value.type === "string") {
      type = value.type as PropertyType;
    }
    return { key, type };
  });
}

function outputFieldsToManifest(fields: OutputFieldDraft[]): Record<string, unknown> | undefined {
  const valid = fields.filter((f) => f.key.trim() && f.type);
  if (valid.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const f of valid) {
    out[f.key.trim()] = f.type;
  }
  return out;
}

export function AgentBuilder({ manifest, onChange, catalog, idLocked }: AgentBuilderProps) {
  const parsed = useMemo<Record<string, unknown>>(() => {
    try {
      const v = parseYAML(manifest);
      return isRecord(v) ? v : {};
    } catch {
      return {};
    }
  }, [manifest]);

  const id = asString(parsed.id);
  const name = asString(parsed.name);
  const description = asString(parsed.description);
  const instruction = asString(parsed.instruction);
  const kindRaw = asString(parsed.kind);
  const kind: AgentKindOption | "" = (AGENT_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as AgentKindOption)
    : "";

  const model = isRecord(parsed.model) ? parsed.model : {};
  const provider = asString(model.provider);
  const modelName = asString(model.name);
  const temperature = asNumber(model.temperature);
  const maxTokens = asNumber(model.maxTokens);
  const topP = asNumber(model.topP);

  const toolEntries = useMemo(() => toolEntriesFromManifest(parsed), [parsed]);
  const spawnable = useMemo(() => spawnableFromManifest(parsed), [parsed]);
  const outputFields = useMemo(() => outputFieldsFromManifest(parsed), [parsed]);

  const writeBack = (next: Record<string, unknown>) => {
    onChange(stringifyYAML(next, { lineWidth: 0 }));
  };

  const setIdentity = (patch: Partial<Record<"id" | "name" | "description" | "kind", string>>) => {
    const next: Record<string, unknown> = { ...parsed };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === "" && key !== "id" && key !== "kind") {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    writeBack(orderManifestKeys(next));
  };

  const setModel = (model: {
    provider: string;
    name: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  }) => {
    const next: Record<string, unknown> = { ...parsed };
    const modelObj: Record<string, unknown> = {
      provider: model.provider,
      name: model.name,
    };
    if (model.temperature !== undefined) modelObj.temperature = model.temperature;
    if (model.maxTokens !== undefined) modelObj.maxTokens = model.maxTokens;
    if (model.topP !== undefined) modelObj.topP = model.topP;
    next.model = modelObj;
    writeBack(orderManifestKeys(next));
  };

  const setTools = (entries: ToolEntryDraft[]) => {
    const next: Record<string, unknown> = { ...parsed };
    const arr = toolEntriesToManifest(entries);
    if (arr.length === 0) delete next.tools;
    else next.tools = arr;
    writeBack(orderManifestKeys(next));
  };

  const setSpawnable = (entries: SpawnableDraft[]) => {
    const next: Record<string, unknown> = { ...parsed };
    if (entries.length === 0) {
      delete next.spawnable;
    } else {
      next.spawnable = spawnableToManifest(entries, parsed.spawnable);
    }
    writeBack(orderManifestKeys(next));
  };

  const setInstruction = (next: string) => {
    const parsedNext: Record<string, unknown> = { ...parsed };
    if (next === "") {
      delete parsedNext.instruction;
    } else {
      parsedNext.instruction = next;
    }
    writeBack(orderManifestKeys(parsedNext));
  };

  const setOutput = (fields: OutputFieldDraft[]) => {
    const next: Record<string, unknown> = { ...parsed };
    const schema = outputFieldsToManifest(fields);
    if (!schema) delete next.outputSchema;
    else next.outputSchema = schema;
    writeBack(orderManifestKeys(next));
  };

  const showLlmSections = kind === "llm" || kind === "";

  return (
    <div className="space-y-4">
      <IdentitySection
        id={id}
        name={name}
        description={description}
        kind={kind}
        idLocked={idLocked}
        onIdChange={(v) => setIdentity({ id: v })}
        onNameChange={(v) => setIdentity({ name: v })}
        onDescriptionChange={(v) => setIdentity({ description: v })}
        onKindChange={(v) => setIdentity({ kind: v })}
      />

      {showLlmSections && (
        <>
          <InstructionSection instruction={instruction} onChange={setInstruction} />

          <ModelSection
            provider={provider}
            name={modelName}
            temperature={temperature}
            maxTokens={maxTokens}
            topP={topP}
            catalog={catalog}
            onChange={setModel}
          />

          <ToolsSection entries={toolEntries} catalog={catalog} onChange={setTools} />

          <SpawnableSection entries={spawnable} catalog={catalog} onChange={setSpawnable} />

          <OutputSection fields={outputFields} onChange={setOutput} />
        </>
      )}

      {!showLlmSections && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
          Forms for <span className="font-mono">{kind}</span> agents aren't built yet. Edit
          in YAML view.
        </div>
      )}
    </div>
  );
}

const PREFERRED_ORDER = [
  "id",
  "name",
  "description",
  "kind",
  "inputSchema",
  "stateKey",
  "model",
  "instruction",
  "examples",
  "tools",
  "spawnable",
  "outputSchema",
  "tool",
  "steps",
  "branches",
  "until",
  "maxIterations",
  "output",
];

function orderManifestKeys(manifest: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of PREFERRED_ORDER) {
    if (key in manifest) ordered[key] = manifest[key];
  }
  for (const key of Object.keys(manifest)) {
    if (!(key in ordered)) ordered[key] = manifest[key];
  }
  return ordered;
}
