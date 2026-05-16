"use client";

import { useState } from "react";

export interface SecretDraft {
  name: string;
  /**
   * Plaintext value. In "create" mode this is required and non-empty.
   * In "edit" mode, an empty string means "leave the existing value
   * unchanged". The API contract handles both shapes.
   */
  value: string;
  description: string;
}

export interface SecretEditorSubmit {
  name: string;
  value: string;
  description: string;
}

interface SecretEditorProps {
  initial: SecretDraft;
  /** When true, name input is disabled and value can be left blank. */
  lockName?: boolean;
  /**
   * Last four characters of the existing value, shown in edit mode as a
   * masked indicator (`••••<lastFour>`). Ignored when undefined.
   */
  lastFour?: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (
    draft: SecretEditorSubmit,
  ) => Promise<{ error?: string } | void>;
}

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function SecretEditor({
  initial,
  lockName = false,
  lastFour,
  submitLabel,
  submittingLabel,
  onSubmit,
}: SecretEditorProps) {
  const [name, setName] = useState(initial.name);
  const [value, setValue] = useState(initial.value);
  const [description, setDescription] = useState(initial.description);
  const [showValue, setShowValue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!lockName) {
      if (!name) return "Name is required.";
      if (!NAME_RE.test(name)) {
        return "Name must be lowercase letters, digits, and underscores; starts with a letter (e.g. 'my_token').";
      }
      if (value === "") return "Value is required.";
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await onSubmit({ name, value, description });
    if (result && "error" in result && result.error) setError(result.error);
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Identity">
        <Field
          label="Name"
          hint={
            lockName
              ? "Secret names are immutable — delete and re-create to rename."
              : "Lowercase letters, digits, underscores. Starts with a letter. Referenced as {{secrets.<name>}}."
          }
        >
          <input
            type="text"
            value={name}
            disabled={lockName}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_token"
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none disabled:bg-stone-50 disabled:text-zinc-500"
          />
        </Field>

        <Field
          label="Value"
          hint={
            lockName
              ? "Leave blank to keep the current value. Type a new value to replace it."
              : "Stored encrypted at rest. Only the runtime ever decrypts it."
          }
        >
          {lockName && lastFour && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-1.5 font-mono text-xs text-zinc-700">
              <span aria-hidden>Current:</span>
              <span>••••{lastFour}</span>
            </div>
          )}
          <div className="relative">
            <input
              type={showValue ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={lockName ? "Leave blank to keep current value" : "sk-…"}
              autoComplete="new-password"
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 pr-16 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowValue((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-stone-300 hover:bg-stone-50"
            >
              {showValue ? "Hide" : "Show"}
            </button>
          </div>
        </Field>

        <Field
          label="Description"
          hint="Optional. Reminds you what this secret is for; never shown to the LLM."
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this secret is for (optional)."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
          />
        </Field>
      </Section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
