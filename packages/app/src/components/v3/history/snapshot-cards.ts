// Kind-aware "headline" cards shown above the YAML in snapshot view.
// The card set re-shapes per agent kind so a pipeline doesn't display
// a meaningless "Model" card.

export interface SnapCard {
  label: string;
  value: string;
  sub: string;
  mono?: boolean;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
  return [];
}

function schemaFieldList(value: unknown): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>);
  }
  return asStringList(value);
}

function describe(value: unknown, fallback = "—"): string {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

/**
 * Derive a 3–4 card summary from a parsed YAML manifest. Cards are picked
 * from the agent's `kind` so the user sees meaningful summary information
 * (e.g. "Steps" for a sequential agent, "Model" for an LLM agent).
 */
export function snapshotCards(parsed: Record<string, unknown> | null): SnapCard[] {
  if (!parsed) return [];
  const kind = (parsed.kind as string) ?? "llm";

  if (kind === "llm") {
    const model = (parsed.model as Record<string, unknown>) ?? {};
    const inputs = schemaFieldList(parsed.inputSchema);
    const outputs = schemaFieldList(parsed.outputSchema);
    const tools = (parsed.tools as Array<Record<string, unknown>>) ?? [];
    return [
      {
        label: "Model",
        value: describe(model.name, "—"),
        mono: true,
        sub: `${describe(model.provider, "?")} · temp ${describe(model.temperature, "?")} · ${describe(model.maxTokens, "?")} tok`,
      },
      {
        label: "Inputs",
        value: String(inputs.length),
        sub: inputs.join(" · ") || "—",
      },
      {
        label: "Tools",
        value: String(tools.length),
        sub: tools.map((t) => describe((t as { kind?: string }).kind, "tool")).join(" · ") || "none",
      },
      {
        label: "Output",
        value: `${outputs.length} field${outputs.length === 1 ? "" : "s"}`,
        sub: outputs.join(" · ") || "—",
      },
    ];
  }

  if (kind === "sequential") {
    const steps = asStringList(parsed.steps);
    const inputs = schemaFieldList(parsed.inputSchema);
    const outputs = schemaFieldList(parsed.output ?? parsed.outputSchema);
    const loop = parsed.until ? `loops until ${describe(parsed.until)} · max ${describe(parsed.maxIterations, "?")}` : "linear · no loop";
    return [
      { label: "Kind", value: "sequential", mono: true, sub: loop },
      { label: "Steps", value: String(steps.length), sub: steps.join(" → ") || "—" },
      { label: "Inputs", value: String(inputs.length), sub: inputs.join(" · ") || "—" },
      { label: "Output", value: `${outputs.length} field${outputs.length === 1 ? "" : "s"}`, sub: outputs.join(" · ") || "—" },
    ];
  }

  if (kind === "parallel") {
    const branches = asStringList(parsed.branches);
    const inputs = schemaFieldList(parsed.inputSchema);
    const outputs = schemaFieldList(parsed.output ?? parsed.outputSchema);
    return [
      { label: "Kind", value: "parallel", mono: true, sub: `${branches.length} branches run together` },
      { label: "Branches", value: String(branches.length), sub: branches.join(" · ") || "—" },
      { label: "Inputs", value: String(inputs.length), sub: inputs.join(" · ") || "—" },
      { label: "Output", value: `${outputs.length} field${outputs.length === 1 ? "" : "s"}`, sub: outputs.join(" · ") || "—" },
    ];
  }

  if (kind === "tool") {
    const tool = (parsed.tool as Record<string, unknown>) ?? {};
    const inputs = schemaFieldList(parsed.inputSchema);
    return [
      { label: "Kind", value: "tool", mono: true, sub: "deterministic · no LLM" },
      { label: "Tool", value: describe(tool.name, "?"), mono: true, sub: describe(tool.kind, "—") },
      { label: "Inputs", value: String(inputs.length), sub: inputs.join(" · ") || "—" },
      { label: "Output", value: describe(parsed.outputType, "—"), sub: "—" },
    ];
  }

  // Unknown kind — fall back to a generic two-card summary.
  return [
    { label: "Kind", value: kind, mono: true, sub: "—" },
    { label: "Id", value: describe(parsed.id), mono: true, sub: describe(parsed.name) },
  ];
}
