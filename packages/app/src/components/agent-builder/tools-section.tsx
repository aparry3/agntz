"use client";

import { useEffect, useMemo } from "react";
import { parseUrlPlaceholders } from "@agntz/manifest";
import type { Catalog } from "@/lib/use-catalog";
import { TOOL_ENTRY_KINDS, type ToolEntryKind } from "@/lib/manifest-catalog";
import { Field, SectionCard, Select, SmallButton, TextArea, TextInput } from "./form-controls";
import { PlaceholderPreview } from "./placeholder-preview";
import { HeadersEditor } from "./headers-editor";
import { ParamsEditor } from "./params-editor";

export interface ToolEntryDraft {
  kind: ToolEntryKind | "";
  // For kind=local or mcp: list of tool names.
  tools: string[];
  // For kind=mcp: server id.
  server?: string;
  // For kind=agent: agent id.
  agent?: string;
  // For kind=http: see HTTPToolEntry in @agntz/manifest.
  name?: string;
  url?: string;
  method?: "GET";
  description?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
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
              // Reset every kind-specific field so the YAML output never
              // accidentally carries forward a stale `server`, `agent`, or
              // HTTP block from a previous kind selection.
              const reset = {
                tools: [],
                server: undefined,
                agent: undefined,
                name: undefined,
                url: undefined,
                method: undefined,
                description: undefined,
                params: undefined,
                headers: undefined,
              };
              if (next === "") {
                onChange({ kind: "", ...reset });
              } else {
                onChange({ kind: next, ...reset });
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

          {entry.kind === "http" && (
            <HttpEntryFields entry={entry} catalog={catalog} onChange={onChange} />
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

// ═══════════════════════════════════════════════════════════════════════
// HTTP tool entry fields
// ═══════════════════════════════════════════════════════════════════════

const HTTP_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function HttpEntryFields({
  entry,
  catalog,
  onChange,
}: {
  entry: ToolEntryDraft;
  catalog: Catalog;
  onChange: (patch: Partial<ToolEntryDraft>) => void;
}) {
  const url = entry.url ?? "";
  const params = entry.params ?? {};
  const headers = entry.headers ?? {};

  // Parse placeholders client-side for instant feedback. Validators on the
  // server still run on save, but this drives both the PlaceholderPreview
  // and the optional-in-path lint warning below.
  const placeholders = useMemo(
    () => (url ? parseUrlPlaceholders(url) : []),
    [url],
  );
  const optionalInPath = useMemo(
    () => placeholders.some((p) => p.position === "path" && p.optional),
    [placeholders],
  );

  const nameInvalid = entry.name != null && entry.name.length > 0 && !HTTP_NAME_RE.test(entry.name);

  return (
    <div className="space-y-3">
      <Field
        label="Tool name"
        hint="Becomes http__<name> for the model. Lowercase letters, digits, underscores; must start with a letter or underscore."
      >
        <TextInput
          value={entry.name ?? ""}
          onChange={(v) => onChange({ name: v })}
          placeholder="e.g. github_get_user"
        />
        {nameInvalid && (
          <span className="mt-1 block text-[11px] text-red-600">
            Name must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.
          </span>
        )}
      </Field>

      <Field
        label="URL"
        hint="Use {placeholder} for required params, {placeholder?} for optional query params."
      >
        <TextInput
          value={url}
          onChange={(v) => onChange({ url: v })}
          placeholder="https://api.example.com/users/{userId}?status={status?}"
          mono
        />
        <PlaceholderPreview url={url} pinnedKeys={Object.keys(params)} />
        {optionalInPath && (
          <span className="mt-1 block text-[11px] text-red-600">
            Optional placeholders ({"{X?}"}) are only allowed in the query string.
          </span>
        )}
      </Field>

      <Field
        label="Method"
        hint="Only GET supported in this release."
      >
        <Select<"GET">
          value="GET"
          onChange={() => onChange({ method: "GET" })}
          options={[{ value: "GET", label: "GET" }]}
        />
      </Field>

      <Field
        label="Description"
        hint="Shown to the LLM. Helps it decide when to call this tool."
      >
        <TextArea
          value={entry.description ?? ""}
          onChange={(v) => onChange({ description: v })}
          placeholder="Looks up a user by ID."
          rows={3}
        />
      </Field>

      <HeadersEditor
        headers={headers}
        onChange={(next) => onChange({ headers: next })}
        secrets={catalog.secrets}
      />

      <ParamsEditor
        params={params}
        placeholders={placeholders}
        onChange={(next) => onChange({ params: next })}
        secrets={catalog.secrets}
      />
    </div>
  );
}
