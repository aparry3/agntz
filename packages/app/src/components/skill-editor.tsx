"use client";

import { useState } from "react";

export type ToolRef =
  | { type: "inline"; name: string }
  | { type: "mcp"; server: string; tools?: string[] }
  | { type: "agent"; agentId: string };

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  tools: ToolRef[];
}

interface SkillEditorProps {
  initial: SkillDraft;
  /** When true, name input is disabled (edit existing skill). */
  lockName?: boolean;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (draft: SkillDraft) => Promise<{ error?: string } | void>;
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;

export function SkillEditor({
  initial,
  lockName = false,
  submitLabel,
  submittingLabel,
  onSubmit,
}: SkillEditorProps) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [tools, setTools] = useState<ToolRef[]>(initial.tools);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!NAME_RE.test(name)) {
      return "Name must be lowercase-kebab-case (e.g. 'my-skill').";
    }
    if (description.trim() === "") return "Description is required.";
    if (instructions.trim() === "") return "Instructions are required.";
    for (let i = 0; i < tools.length; i++) {
      const t = tools[i];
      if (t.type === "inline" && !t.name.trim()) return `Tool #${i + 1}: name required.`;
      if (t.type === "mcp" && !t.server.trim()) return `Tool #${i + 1}: server required.`;
      if (t.type === "agent" && !t.agentId.trim()) return `Tool #${i + 1}: agentId required.`;
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
    const result = await onSubmit({ name, description, instructions, tools });
    if (result && "error" in result && result.error) setError(result.error);
    setSubmitting(false);
  };

  const updateTool = (idx: number, next: ToolRef) => {
    setTools((prev) => prev.map((t, i) => (i === idx ? next : t)));
  };

  const removeTool = (idx: number) => {
    setTools((prev) => prev.filter((_, i) => i !== idx));
  };

  const addTool = () => {
    setTools((prev) => [...prev, { type: "inline", name: "" }]);
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Identity">
        <Field label="Name" hint="Lowercase kebab-case. Unique per workspace. Used as the skill identifier.">
          <input
            type="text"
            value={name}
            disabled={lockName}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill"
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none disabled:bg-stone-50 disabled:text-zinc-500"
          />
        </Field>
        <Field
          label="Description"
          hint="Shown to the LLM in the system prompt's available-skills list. Keep it concise."
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this skill helps the agent do."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
          />
        </Field>
      </Section>

      <Section title="Instructions">
        <Field
          label="Instructions"
          hint="Returned to the LLM as the use_skill tool result when this skill is loaded."
        >
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={10}
            placeholder="Step-by-step guidance the agent should follow when this skill is active."
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
          />
        </Field>
      </Section>

      <Section
        title="Tools"
        action={
          <button
            onClick={addTool}
            className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-stone-300 hover:bg-stone-50"
          >
            Add tool
          </button>
        }
      >
        {tools.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-zinc-500">
            No tools attached. Add inline, MCP, or agent tool references to expose them when the skill loads.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {tools.map((tool, i) => (
              <ToolRow
                key={i}
                tool={tool}
                onChange={(next) => updateTool(i, next)}
                onRemove={() => removeTool(i)}
              />
            ))}
          </div>
        )}
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
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
        {action}
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
      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function ToolRow({
  tool,
  onChange,
  onRemove,
}: {
  tool: ToolRef;
  onChange: (next: ToolRef) => void;
  onRemove: () => void;
}) {
  const changeType = (type: ToolRef["type"]) => {
    if (type === "inline") onChange({ type: "inline", name: "" });
    else if (type === "mcp") onChange({ type: "mcp", server: "", tools: [] });
    else onChange({ type: "agent", agentId: "" });
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <select
          value={tool.type}
          onChange={(e) => changeType(e.target.value as ToolRef["type"])}
          className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 transition focus:border-zinc-400 focus:outline-none"
        >
          <option value="inline">Inline</option>
          <option value="mcp">MCP</option>
          <option value="agent">Agent</option>
        </select>
        <button
          onClick={onRemove}
          className="text-xs font-medium text-zinc-500 transition hover:text-red-600"
        >
          Remove
        </button>
      </div>

      {tool.type === "inline" && (
        <input
          type="text"
          value={tool.name}
          onChange={(e) => onChange({ type: "inline", name: e.target.value })}
          placeholder="tool-name"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
        />
      )}

      {tool.type === "mcp" && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={tool.server}
            onChange={(e) => onChange({ type: "mcp", server: e.target.value, tools: tool.tools })}
            placeholder="server-name"
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
          />
          <input
            type="text"
            value={(tool.tools ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                type: "mcp",
                server: tool.server,
                tools: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="tool1, tool2 (optional, blank = all)"
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
          />
        </div>
      )}

      {tool.type === "agent" && (
        <input
          type="text"
          value={tool.agentId}
          onChange={(e) => onChange({ type: "agent", agentId: e.target.value })}
          placeholder="agent-id"
          className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950 transition focus:border-zinc-400 focus:outline-none"
        />
      )}
    </div>
  );
}
