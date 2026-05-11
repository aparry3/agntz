"use client";

import { useEffect } from "react";
import type { Catalog } from "@/lib/use-catalog";
import { TOOL_ENTRY_KINDS, type ToolEntryKind } from "@/lib/manifest-catalog";
import { Field, SectionCard, Select, SmallButton, TextInput } from "./form-controls";

export interface ToolEntryDraft {
  kind: ToolEntryKind | "";
  // For kind=local or mcp: list of tool names.
  tools: string[];
  // For kind=mcp: server id.
  server?: string;
  // For kind=agent: agent id.
  agent?: string;
}

interface ToolsSectionProps {
  entries: ToolEntryDraft[];
  catalog: Catalog;
  onChange: (entries: ToolEntryDraft[]) => void;
}

export function ToolsSection({ entries, catalog, onChange }: ToolsSectionProps) {
  useEffect(() => {
    for (const entry of entries) {
      if (entry.kind === "mcp" && entry.server && !catalog.mcpToolsByServer[entry.server]) {
        catalog.loadMcpTools(entry.server);
      }
    }
  }, [entries, catalog]);

  const updateEntry = (index: number, patch: Partial<ToolEntryDraft>) => {
    const next = [...entries];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const addEntry = () => {
    onChange([...entries, { kind: "", tools: [] }]);
  };

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  return (
    <SectionCard
      title="Tools"
      description="Tools this agent can call: local (registered), MCP, or another agent."
      actions={<SmallButton label="Add tool" onClick={addEntry} />}
    >
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-zinc-500">
          No tools yet.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <ToolEntryRow
              key={index}
              entry={entry}
              catalog={catalog}
              onChange={(patch) => updateEntry(index, patch)}
              onRemove={() => removeEntry(index)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ToolEntryRow({
  entry,
  catalog,
  onChange,
  onRemove,
}: {
  entry: ToolEntryDraft;
  catalog: Catalog;
  onChange: (patch: Partial<ToolEntryDraft>) => void;
  onRemove: () => void;
}) {
  const inlineTools = catalog.tools.filter((t) => t.source === "inline");
  const mcpToolList = entry.server ? catalog.mcpToolsByServer[entry.server] ?? [] : [];

  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
        <Field label="Kind">
          <Select<ToolEntryKind>
            value={entry.kind}
            allowEmpty
            emptyLabel="Select…"
            onChange={(next) => {
              if (next === "") {
                onChange({ kind: "", tools: [], server: undefined, agent: undefined });
              } else {
                onChange({ kind: next, tools: [], server: undefined, agent: undefined });
              }
            }}
            options={TOOL_ENTRY_KINDS.map((k) => ({ value: k, label: k }))}
          />
        </Field>

        <div>
          {entry.kind === "local" && (
            <Field
              label="Tools"
              hint="Inline tools registered with the runner."
            >
              <MultiSelect
                values={entry.tools}
                onChange={(next) => onChange({ tools: next })}
                options={inlineTools.map((t) => ({ value: t.name, label: t.name, hint: t.description }))}
                placeholder="Select tools…"
              />
            </Field>
          )}

          {entry.kind === "mcp" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Server">
                <Select<string>
                  value={entry.server ?? ""}
                  allowEmpty
                  emptyLabel="Select server…"
                  onChange={(next) => {
                    onChange({ server: next || undefined, tools: [] });
                    if (next) catalog.loadMcpTools(next);
                  }}
                  options={catalog.mcpServers.map((s) => ({
                    value: s.id,
                    label: s.displayName,
                  }))}
                />
              </Field>
              <Field
                label="Tools"
                hint={
                  entry.server && mcpToolList.length === 0
                    ? "No tools found (or still loading)."
                    : "Leave empty to expose all tools on this server."
                }
              >
                <MultiSelect
                  values={entry.tools}
                  onChange={(next) => onChange({ tools: next })}
                  options={mcpToolList.map((name) => ({ value: name, label: name }))}
                  placeholder="All tools"
                  allowFreeText
                />
              </Field>
            </div>
          )}

          {entry.kind === "agent" && (
            <Field label="Agent">
              <Select<string>
                value={entry.agent ?? ""}
                allowEmpty
                emptyLabel="Select agent…"
                onChange={(next) => onChange({ agent: next || undefined })}
                options={catalog.agents.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          )}

          {entry.kind === "" && (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-4 text-xs text-zinc-500">
              Pick a kind to configure this tool entry.
            </div>
          )}
        </div>

        <div className="flex items-end justify-end">
          <SmallButton label="Remove" onClick={onRemove} tone="danger" />
        </div>
      </div>
    </div>
  );
}

function MultiSelect({
  values,
  onChange,
  options,
  placeholder,
  allowFreeText,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  placeholder?: string;
  allowFreeText?: boolean;
}) {
  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const addFreeText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) return;
    onChange([...values, trimmed]);
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-2">
      <div className="flex flex-wrap gap-1">
        {values.length === 0 && (
          <span className="px-2 py-1 text-xs text-zinc-400">{placeholder ?? "Nothing selected"}</span>
        )}
        {values.map((value, index) => (
          <span
            key={`${value}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700"
          >
            {value}
            <button
              type="button"
              onClick={() => removeAt(index)}
              className="text-zinc-400 hover:text-zinc-700"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {options.length > 0 && (
        <div className="mt-2 max-h-40 overflow-auto border-t border-stone-100 pt-2">
          {options.map((option) => {
            const selected = values.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  selected ? "bg-zinc-100 text-zinc-950" : "text-zinc-700 hover:bg-stone-50"
                }`}
              >
                <span className="font-medium">{option.label}</span>
                {option.hint && (
                  <span className="ml-2 text-[11px] text-zinc-500">{option.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {allowFreeText && (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <FreeTextAdd onAdd={addFreeText} />
        </div>
      )}
    </div>
  );
}

function FreeTextAdd({ onAdd }: { onAdd: (text: string) => void }) {
  return (
    <input
      type="text"
      placeholder="Add custom name…"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const target = event.currentTarget;
          onAdd(target.value);
          target.value = "";
        }
      }}
      className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs outline-none focus:border-zinc-400 focus:bg-white"
    />
  );
}
