"use client";

import { useId, useMemo } from "react";
import type { Placeholder } from "@agntz/manifest";
import { Field, SmallButton, TextInput } from "./form-controls";
import { appendSecretRef, type HeadersEditorSecret } from "./headers-editor";

interface ParamsEditorProps {
  params: Record<string, string>;
  placeholders: Placeholder[];
  onChange: (next: Record<string, string>) => void;
  secrets: HeadersEditorSecret[];
}

/**
 * One row per URL placeholder. A pinned template in the row's input means the
 * runtime fills the placeholder with that template (interpolated against
 * agent state); a blank row means the placeholder is exposed to the LLM as a
 * tool input. Secret references can be inserted via the "Insert secret" menu
 * so users can pin a query param to a stored credential without seeing the
 * decrypted value.
 *
 * NOTE: the editor is derived from the placeholder list, NOT from the
 * `params` keys. If the user's URL no longer contains a placeholder that was
 * previously pinned, the stale pin is shown in a "stale" footer section so it
 * doesn't silently get dropped on save (the user might be mid-edit).
 */
export function ParamsEditor({
  params,
  placeholders,
  onChange,
  secrets,
}: ParamsEditorProps) {
  // Dedup placeholders by name; the URL parser returns one per occurrence.
  const uniquePlaceholders = useMemo(() => {
    const seen = new Map<string, Placeholder>();
    for (const p of placeholders) {
      if (!seen.has(p.name)) seen.set(p.name, p);
    }
    return Array.from(seen.values());
  }, [placeholders]);

  const placeholderNames = useMemo(
    () => new Set(uniquePlaceholders.map((p) => p.name)),
    [uniquePlaceholders],
  );

  const stalePins = useMemo(
    () => Object.keys(params).filter((k) => !placeholderNames.has(k)),
    [params, placeholderNames],
  );

  const setPin = (name: string, value: string) => {
    const next = { ...params };
    if (value.trim().length === 0) {
      delete next[name];
    } else {
      next[name] = value;
    }
    onChange(next);
  };

  const dropStale = (name: string) => {
    const next = { ...params };
    delete next[name];
    onChange(next);
  };

  return (
    <Field
      label="Params"
      hint="Leave a row blank to expose that placeholder to the LLM. Filled rows are pinned to the value and hidden from the LLM."
    >
      <div className="space-y-2">
        {uniquePlaceholders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-3 text-xs text-zinc-500">
            No placeholders in URL — nothing to pin.
          </div>
        ) : (
          uniquePlaceholders.map((p) => (
            <ParamRow
              key={p.name}
              placeholder={p}
              value={params[p.name] ?? ""}
              onChange={(v) => setPin(p.name, v)}
              secrets={secrets}
            />
          ))
        )}

        {stalePins.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Stale pins (no matching URL placeholder)
            </div>
            <div className="space-y-1">
              {stalePins.map((name) => (
                <div key={name} className="flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className="font-mono font-medium text-amber-900">
                      {name}
                    </span>{" "}
                    <span className="text-amber-700">= {params[name]}</span>
                  </div>
                  <SmallButton
                    label="Drop"
                    onClick={() => dropStale(name)}
                    tone="danger"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

function ParamRow({
  placeholder,
  value,
  onChange,
  secrets,
}: {
  placeholder: Placeholder;
  value: string;
  onChange: (next: string) => void;
  secrets: HeadersEditorSecret[];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="pt-2.5">
        <span className="font-mono text-xs font-semibold text-zinc-800">
          {placeholder.name}
          {placeholder.optional && <span className="text-zinc-400">?</span>}
        </span>
        <span className="ml-2 text-[11px] text-zinc-500">
          ({placeholder.position})
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <TextInput
          value={value}
          onChange={onChange}
          placeholder="Leave blank to let the LLM provide this"
          mono
        />
        <div className="flex justify-end">
          <InsertSecretMenu
            secrets={secrets}
            onPick={(name) => onChange(appendSecretRef(value, name))}
          />
        </div>
      </div>
    </div>
  );
}

function InsertSecretMenu({
  secrets,
  onPick,
}: {
  secrets: HeadersEditorSecret[];
  onPick: (name: string) => void;
}) {
  const id = useId();
  return (
    <details className="relative">
      <summary className="cursor-pointer select-none list-none rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] text-zinc-600 hover:bg-stone-50">
        Insert secret →
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-60 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
        {secrets.length === 0 ? (
          <div className="px-2 py-1.5 text-[11px] text-zinc-500">
            No secrets defined.
          </div>
        ) : (
          secrets.map((secret) => (
            <button
              key={`${id}-${secret.name}`}
              type="button"
              onClick={(event) => {
                onPick(secret.name);
                const details = event.currentTarget.closest("details");
                if (details) details.removeAttribute("open");
              }}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-stone-50"
            >
              <span className="font-mono font-medium text-zinc-800">
                {secret.name}
              </span>
              {secret.lastFour && (
                <span className="ml-2 text-[11px] text-zinc-400">
                  ••••{secret.lastFour}
                </span>
              )}
            </button>
          ))
        )}
        <div className="mt-1 border-t border-stone-100 pt-1">
          <a
            href="/settings/secrets/new"
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-600 hover:bg-stone-50"
          >
            + New secret…
          </a>
        </div>
      </div>
    </details>
  );
}
