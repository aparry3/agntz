import { parse as parseYAML } from "yaml";
import { normalizeManifest } from "./parser.js";
import { normalizeId } from "./state.js";
import type {
  AgentManifest,
  LLMAgentManifest,
  ToolAgentManifest,
  SequentialAgentManifest,
  ParallelAgentManifest,
  StepRef,
  InputSchema,
  OutputSchema,
  OutputMapping,
  ManifestToolEntry,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  manifest?: AgentManifest;
}

export interface ValidationError {
  level: "structural" | "reference" | "external";
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface ValidationContext {
  resolveAgent: (id: string) => Promise<boolean>;
  resolveTools: (server: string) => Promise<string[]>;
  localTools: string[];
  /** Check if a provider has a configured API key */
  isProviderConfigured?: (provider: string) => Promise<boolean>;
  /**
   * When true, MCP server connection failures are reported as errors
   * instead of warnings. Use for save-time validation where an unreachable
   * server should block persistence; leave false for live-editor validation
   * where transient network issues shouldn't flood the editor with errors.
   */
  strict?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// Main API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validate a YAML manifest string (structural + reference integrity).
 * Synchronous — no external calls.
 */
export function validateManifest(yaml: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Level 1: Structural
  let raw: Record<string, unknown>;
  try {
    raw = parseYAML(yaml);
    if (!raw || typeof raw !== "object") {
      errors.push({ level: "structural", path: "", message: "YAML must be an object" });
      return { valid: false, errors, warnings };
    }
  } catch (e) {
    errors.push({ level: "structural", path: "", message: `YAML syntax error: ${(e as Error).message}` });
    return { valid: false, errors, warnings };
  }

  let manifest: AgentManifest;
  try {
    manifest = normalizeManifest(raw);
  } catch (e) {
    errors.push({ level: "structural", path: "", message: (e as Error).message });
    return { valid: false, errors, warnings };
  }

  // Deep structural validation
  validateStructural(manifest, "", errors, warnings);

  // Level 2: Reference integrity (only if structurally valid)
  if (errors.length === 0) {
    validateReferences(manifest, "", errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.filter((e) => e.level === "structural").length === 0 ? manifest : undefined,
  };
}

/**
 * Full validation including external checks (async).
 * Runs structural + reference first, then external.
 */
export async function validateManifestFull(
  yaml: string,
  ctx: ValidationContext
): Promise<ValidationResult> {
  const result = validateManifest(yaml);

  // Only run external validation if structural/reference passed
  if (result.manifest) {
    await validateExternal(result.manifest, "", result.errors, result.warnings, ctx);
    result.valid = result.errors.length === 0;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Level 1: Structural Validation
// ═══════════════════════════════════════════════════════════════════════

function validateStructural(
  manifest: AgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Common fields
  if (!manifest.id || typeof manifest.id !== "string") {
    errors.push({ level: "structural", path: p(path, "id"), message: "id is required and must be a string" });
  }

  if (manifest.inputSchema) {
    validatePropertySchema(manifest.inputSchema, p(path, "inputSchema"), errors);
  }

  switch (manifest.kind) {
    case "llm":
      validateLLMStructural(manifest, path, errors, warnings);
      break;
    case "tool":
      validateToolStructural(manifest, path, errors);
      break;
    case "sequential":
      validateSequentialStructural(manifest, path, errors, warnings);
      break;
    case "parallel":
      validateParallelStructural(manifest, path, errors, warnings);
      break;
  }
}

function validateLLMStructural(
  manifest: LLMAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!manifest.model) {
    errors.push({ level: "structural", path: p(path, "model"), message: "LLM agent must have a model" });
  } else {
    if (!manifest.model.provider) {
      errors.push({ level: "structural", path: p(path, "model.provider"), message: "model.provider is required" });
    }
    if (!manifest.model.name) {
      errors.push({ level: "structural", path: p(path, "model.name"), message: "model.name is required" });
    }
    if (manifest.model.temperature != null && (manifest.model.temperature < 0 || manifest.model.temperature > 2)) {
      warnings.push({ path: p(path, "model.temperature"), message: "temperature is typically between 0 and 2" });
    }
  }

  if (!manifest.instruction || typeof manifest.instruction !== "string") {
    errors.push({ level: "structural", path: p(path, "instruction"), message: "LLM agent must have an instruction string" });
  } else {
    validateTemplatesSyntax(manifest.instruction, p(path, "instruction"), errors);
  }

  if (manifest.outputSchema) {
    validatePropertySchema(manifest.outputSchema, p(path, "outputSchema"), errors);
  }

  if (manifest.tools) {
    validateToolEntries(manifest.tools, p(path, "tools"), errors);
  }

  if (manifest.examples) {
    for (let i = 0; i < manifest.examples.length; i++) {
      const ex = manifest.examples[i];
      if (!ex.input || typeof ex.input !== "string") {
        errors.push({ level: "structural", path: p(path, `examples[${i}].input`), message: "Example input must be a string" });
      }
      if (!ex.output || typeof ex.output !== "string") {
        errors.push({ level: "structural", path: p(path, `examples[${i}].output`), message: "Example output must be a string" });
      }
    }
  }
}

function validateToolStructural(
  manifest: ToolAgentManifest,
  path: string,
  errors: ValidationError[]
): void {
  if (!manifest.tool) {
    errors.push({ level: "structural", path: p(path, "tool"), message: "Tool agent must have a tool configuration" });
    return;
  }
  if (!manifest.tool.kind || !["mcp", "local"].includes(manifest.tool.kind)) {
    errors.push({ level: "structural", path: p(path, "tool.kind"), message: "tool.kind must be 'mcp' or 'local'" });
  }
  if (!manifest.tool.name) {
    errors.push({ level: "structural", path: p(path, "tool.name"), message: "tool.name is required" });
  }
  if (manifest.tool.kind === "mcp" && !manifest.tool.server) {
    errors.push({ level: "structural", path: p(path, "tool.server"), message: "MCP tool must have a server URL" });
  }
  if (manifest.tool.params) {
    for (const [key, val] of Object.entries(manifest.tool.params)) {
      if (typeof val !== "string") {
        errors.push({ level: "structural", path: p(path, `tool.params.${key}`), message: "Tool param values must be strings (template expressions)" });
      } else {
        validateTemplatesSyntax(val, p(path, `tool.params.${key}`), errors);
      }
    }
  }
}

function validateSequentialStructural(
  manifest: SequentialAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!manifest.steps || manifest.steps.length === 0) {
    errors.push({ level: "structural", path: p(path, "steps"), message: "Sequential agent must have at least one step" });
    return;
  }

  if (manifest.until) {
    validateTemplatesSyntax(manifest.until, p(path, "until"), errors);
  }

  if (manifest.maxIterations != null && !manifest.until) {
    warnings.push({ path: p(path, "maxIterations"), message: "maxIterations has no effect without 'until'" });
  }

  for (let i = 0; i < manifest.steps.length; i++) {
    validateStep(manifest.steps[i], p(path, `steps[${i}]`), errors, warnings);
  }

  if (manifest.output) {
    validateOutputMapping(manifest.output, p(path, "output"), errors);
  }
}

function validateParallelStructural(
  manifest: ParallelAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!manifest.branches || manifest.branches.length === 0) {
    errors.push({ level: "structural", path: p(path, "branches"), message: "Parallel agent must have at least one branch" });
    return;
  }

  for (let i = 0; i < manifest.branches.length; i++) {
    validateStep(manifest.branches[i], p(path, `branches[${i}]`), errors, warnings);
  }

  if (manifest.output) {
    validateOutputMapping(manifest.output, p(path, "output"), errors);
  }
}

function validateStep(
  step: StepRef,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!step.ref && !step.agent) {
    errors.push({ level: "structural", path, message: "Step must have either 'ref' or 'agent'" });
    return;
  }
  if (step.ref && step.agent) {
    errors.push({ level: "structural", path, message: "Step cannot have both 'ref' and 'agent'" });
    return;
  }

  if (step.ref && typeof step.ref !== "string") {
    errors.push({ level: "structural", path: p(path, "ref"), message: "ref must be a string (agent ID)" });
  }

  if (step.agent) {
    validateStructural(step.agent, p(path, "agent"), errors, warnings);
  }

  if (step.input) {
    for (const [key, val] of Object.entries(step.input)) {
      if (typeof val !== "string") {
        errors.push({ level: "structural", path: p(path, `input.${key}`), message: "Input transform values must be template strings" });
      } else {
        validateTemplatesSyntax(val, p(path, `input.${key}`), errors);
      }
    }
  }

  if (step.when) {
    validateTemplatesSyntax(step.when, p(path, "when"), errors);
  }
}

function validateToolEntries(
  tools: ManifestToolEntry[],
  path: string,
  errors: ValidationError[]
): void {
  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    const epath = `${path}[${i}]`;

    if (!entry.kind || !["mcp", "local", "agent"].includes(entry.kind)) {
      errors.push({ level: "structural", path: epath, message: "Tool entry must have kind: mcp, local, or agent" });
      continue;
    }

    if (entry.kind === "mcp") {
      if (!entry.server) {
        errors.push({ level: "structural", path: p(epath, "server"), message: "MCP tool entry must have a server URL" });
      }
      if (entry.tools) {
        for (let j = 0; j < entry.tools.length; j++) {
          const ref = entry.tools[j];
          if (typeof ref === "object") {
            if (!ref.tool) {
              errors.push({ level: "structural", path: `${epath}.tools[${j}].tool`, message: "Wrapped tool must have a tool name" });
            }
            if (ref.params) {
              for (const [key, val] of Object.entries(ref.params)) {
                validateTemplatesSyntax(val, `${epath}.tools[${j}].params.${key}`, errors);
              }
            }
          }
        }
      }
    }

    if (entry.kind === "local") {
      if (!entry.tools || entry.tools.length === 0) {
        errors.push({ level: "structural", path: epath, message: "Local tool entry must list at least one tool" });
      }
    }

    if (entry.kind === "agent") {
      if (!entry.agent) {
        errors.push({ level: "structural", path: p(epath, "agent"), message: "Agent tool entry must reference an agent ID" });
      }
    }
  }
}

function validatePropertySchema(
  schema: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  const validTypes = ["string", "number", "boolean", "object", "array"];

  for (const [key, def] of Object.entries(schema)) {
    if (typeof def === "string") {
      if (!validTypes.includes(def)) {
        errors.push({ level: "structural", path: p(path, key), message: `Invalid type '${def}'. Must be one of: ${validTypes.join(", ")}` });
      }
    } else if (typeof def === "object" && def !== null) {
      const expanded = def as Record<string, unknown>;
      if (expanded.type && typeof expanded.type === "string" && !validTypes.includes(expanded.type)) {
        errors.push({ level: "structural", path: p(path, `${key}.type`), message: `Invalid type '${expanded.type}'. Must be one of: ${validTypes.join(", ")}` });
      }
    } else {
      errors.push({ level: "structural", path: p(path, key), message: "Property must be a type string or an object with { type, default?, enum?, ... }" });
    }
  }
}

function validateOutputMapping(
  mapping: OutputMapping,
  path: string,
  errors: ValidationError[]
): void {
  for (const [key, val] of Object.entries(mapping)) {
    if (typeof val === "string") {
      validateTemplatesSyntax(val, p(path, key), errors);
    } else if (typeof val === "object" && val !== null) {
      validateOutputMapping(val as OutputMapping, p(path, key), errors);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Template Syntax Validation
// ═══════════════════════════════════════════════════════════════════════

function validateTemplatesSyntax(
  template: string,
  path: string,
  errors: ValidationError[]
): void {
  // Check balanced {{ }}
  let depth = 0;
  for (let i = 0; i < template.length; i++) {
    if (template[i] === "{" && template[i + 1] === "{") {
      depth++;
      i++;
    } else if (template[i] === "}" && template[i + 1] === "}") {
      depth--;
      i++;
      if (depth < 0) {
        errors.push({ level: "structural", path, message: "Unmatched closing '}}'" });
        return;
      }
    }
  }
  if (depth > 0) {
    errors.push({ level: "structural", path, message: "Unmatched opening '{{'" });
  }

  // Check {{#if}} / {{/if}} balance
  const ifOpens = (template.match(/\{\{#if\s/g) || []).length;
  const ifCloses = (template.match(/\{\{\/if\}\}/g) || []).length;
  if (ifOpens !== ifCloses) {
    errors.push({ level: "structural", path, message: `Unbalanced conditional blocks: ${ifOpens} {{#if}} vs ${ifCloses} {{/if}}` });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Level 2: Reference Integrity
// ═══════════════════════════════════════════════════════════════════════

function validateReferences(
  manifest: AgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Collect available state variables for this agent
  const availableVars = collectInputVars(manifest);

  switch (manifest.kind) {
    case "llm":
      validateTemplateRefs(manifest.instruction, availableVars, p(path, "instruction"), errors, warnings);
      break;
    case "tool":
      if (manifest.tool.params) {
        for (const [key, val] of Object.entries(manifest.tool.params)) {
          validateTemplateRefs(val, availableVars, p(path, `tool.params.${key}`), errors, warnings);
        }
      }
      break;
    case "sequential":
      validateSequentialRefs(manifest, path, errors, warnings);
      break;
    case "parallel":
      validateParallelRefs(manifest, path, errors, warnings);
      break;
  }
}

function validateSequentialRefs(
  manifest: SequentialAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const inputVars = collectInputVars(manifest);
  const availableVars = new Set(inputVars);

  const isLoop = !!manifest.until;

  // In a loop, every step's output is part of state from the start of the
  // first iteration (resolving to null until that step runs). Pre-populate
  // so transforms and conditions can legitimately reference forward / self
  // / loop-tail outputs.
  if (isLoop) {
    for (const step of manifest.steps) {
      availableVars.add(getStepStateKey(step));
    }
  }

  // Check stateKey collisions with input
  const stateKeys = new Set<string>();

  for (let i = 0; i < manifest.steps.length; i++) {
    const step = manifest.steps[i];
    const stepPath = p(path, `steps[${i}]`);
    const isFirstStep = i === 0;

    // Validate input transform references
    if (step.input) {
      for (const [key, val] of Object.entries(step.input)) {
        validateTemplateRefs(val, [...availableVars], p(stepPath, `input.${key}`), errors, warnings);
      }
    }

    // Validate when condition references
    if (step.when) {
      validateTemplateRefs(step.when, [...availableVars], p(stepPath, "when"), errors, warnings);
    }

    // Cross-check step.input keys against the inline child's inputSchema.
    // (ref children are checked in the async external pass.)
    if (step.agent) {
      const upstreamKeys = isFirstStep
        ? inputVars
        : getStaticOutputKeys(manifest.steps[i - 1]);
      validateStepInputAgainstChild(step, step.agent, upstreamKeys, stepPath, errors, warnings);
    }

    // Add this step's output to available vars
    const stateKey = getStepStateKey(step);
    if (inputVars.includes(stateKey)) {
      errors.push({ level: "reference", path: stepPath, message: `stateKey '${stateKey}' collides with input property` });
    }
    if (stateKeys.has(stateKey)) {
      warnings.push({ path: stepPath, message: `stateKey '${stateKey}' is used by multiple steps — later step overwrites earlier` });
    }
    stateKeys.add(stateKey);
    availableVars.add(stateKey);

    // Recursively validate inline agent
    if (step.agent) {
      validateReferences(step.agent, p(stepPath, "agent"), errors, warnings);
    }
  }

  // Validate until condition
  if (manifest.until) {
    validateTemplateRefs(manifest.until, [...availableVars], p(path, "until"), errors, warnings);
  }

  // Validate output mapping
  if (manifest.output) {
    validateOutputMappingRefs(manifest.output, [...availableVars], p(path, "output"), errors, warnings);
  }
}

function validateParallelRefs(
  manifest: ParallelAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const inputVars = collectInputVars(manifest);

  for (let i = 0; i < manifest.branches.length; i++) {
    const step = manifest.branches[i];
    const stepPath = p(path, `branches[${i}]`);

    // Branches can only reference input vars (they run in parallel, no cross-branch refs)
    if (step.input) {
      for (const [key, val] of Object.entries(step.input)) {
        validateTemplateRefs(val, inputVars, p(stepPath, `input.${key}`), errors, warnings);
      }
    }

    // Each branch's default upstream is the parent's input.
    if (step.agent) {
      validateStepInputAgainstChild(step, step.agent, inputVars, stepPath, errors, warnings);
    }

    if (step.agent) {
      validateReferences(step.agent, p(stepPath, "agent"), errors, warnings);
    }
  }

  // Output mapping can reference all branch outputs
  if (manifest.output) {
    const allVars = [...inputVars];
    for (const step of manifest.branches) {
      allVars.push(getStepStateKey(step));
    }
    validateOutputMappingRefs(manifest.output, allVars, p(path, "output"), errors, warnings);
  }
}

function validateTemplateRefs(
  template: string,
  availableVars: string[],
  path: string,
  errors: ValidationError[],
  _warnings: ValidationWarning[]
): void {
  // Extract {{varName}} references (not #if or /if)
  const varRefs = template.matchAll(/\{\{(?!#if\s|\/if)([^}]+)\}\}/g);
  for (const match of varRefs) {
    const ref = match[1].trim();
    const rootVar = ref.split(".")[0];
    if (!availableVars.includes(rootVar)) {
      errors.push({
        level: "reference",
        path,
        message: `Template variable '{{${ref}}}' references '${rootVar}' which is not in scope. Available: ${availableVars.join(", ") || "(none)"}`,
      });
    }
  }

  // Extract {{#if varName}} references
  const condRefs = template.matchAll(/\{\{#if\s+(.+?)\}\}/g);
  for (const match of condRefs) {
    const condition = match[1].trim();
    // Extract variable references from condition
    const condVars = condition.matchAll(/\{\{(.+?)\}\}/g);
    for (const condMatch of condVars) {
      const rootVar = condMatch[1].trim().split(".")[0];
      if (!availableVars.includes(rootVar)) {
        errors.push({
          level: "reference",
          path,
          message: `Condition references '${rootVar}' which is not in scope. Available: ${availableVars.join(", ") || "(none)"}`,
        });
      }
    }
    // Also check bare variable names (e.g. {{#if feedback}})
    if (!condition.includes("{{") && !condition.includes("==") && !condition.includes("!=")) {
      const rootVar = condition.split(".")[0];
      if (!availableVars.includes(rootVar)) {
        errors.push({
          level: "reference",
          path,
          message: `Condition references '${rootVar}' which is not in scope. Available: ${availableVars.join(", ") || "(none)"}`,
        });
      }
    }
  }
}

function validateOutputMappingRefs(
  mapping: OutputMapping,
  availableVars: string[],
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  for (const [key, val] of Object.entries(mapping)) {
    if (typeof val === "string") {
      validateTemplateRefs(val, availableVars, p(path, key), errors, warnings);
    } else if (typeof val === "object") {
      validateOutputMappingRefs(val as OutputMapping, availableVars, p(path, key), errors, warnings);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Level 3: External Validation
// ═══════════════════════════════════════════════════════════════════════

async function validateExternal(
  manifest: AgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  ctx: ValidationContext
): Promise<void> {
  switch (manifest.kind) {
    case "llm":
      // Check provider is configured
      if (ctx.isProviderConfigured && manifest.model?.provider) {
        const configured = await ctx.isProviderConfigured(manifest.model.provider);
        if (!configured) {
          errors.push({
            level: "external",
            path: p(path, "model.provider"),
            message: `Provider '${manifest.model.provider}' is not configured. Add an API key in Settings > Providers.`,
          });
        }
      }
      if (manifest.tools) {
        await validateToolEntriesExternal(manifest.tools, p(path, "tools"), errors, warnings, ctx);
      }
      break;
    case "tool":
      await validateToolCallExternal(manifest, path, errors, warnings, ctx);
      break;
    case "sequential":
      for (let i = 0; i < manifest.steps.length; i++) {
        await validateStepExternal(manifest.steps[i], p(path, `steps[${i}]`), errors, warnings, ctx);
      }
      break;
    case "parallel":
      for (let i = 0; i < manifest.branches.length; i++) {
        await validateStepExternal(manifest.branches[i], p(path, `branches[${i}]`), errors, warnings, ctx);
      }
      break;
  }
}

async function validateStepExternal(
  step: StepRef,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  ctx: ValidationContext
): Promise<void> {
  if (step.ref) {
    const exists = await ctx.resolveAgent(step.ref);
    if (!exists) {
      errors.push({ level: "external", path: p(path, "ref"), message: `Referenced agent '${step.ref}' not found` });
    }
  }
  if (step.agent) {
    await validateExternal(step.agent, p(path, "agent"), errors, warnings, ctx);
  }
}

async function validateToolEntriesExternal(
  tools: ManifestToolEntry[],
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  ctx: ValidationContext
): Promise<void> {
  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    const epath = `${path}[${i}]`;

    if (entry.kind === "mcp") {
      try {
        const available = await ctx.resolveTools(entry.server);
        if (entry.tools) {
          for (let j = 0; j < entry.tools.length; j++) {
            const ref = entry.tools[j];
            const toolName = typeof ref === "string" ? ref : ref.tool;
            if (!available.includes(toolName)) {
              errors.push({
                level: "external",
                path: `${epath}.tools[${j}]`,
                message: `Tool '${toolName}' not found on MCP server '${entry.server}'. Available: ${available.join(", ")}`,
              });
            }
          }
        }
      } catch (e) {
        const message = `Could not connect to MCP server '${entry.server}': ${(e as Error).message}`;
        if (ctx.strict) {
          errors.push({ level: "external", path: epath, message });
        } else {
          warnings.push({ path: epath, message });
        }
      }
    }

    if (entry.kind === "local") {
      for (const name of entry.tools) {
        if (!ctx.localTools.includes(name)) {
          errors.push({ level: "external", path: epath, message: `Local tool '${name}' is not registered` });
        }
      }
    }

    if (entry.kind === "agent") {
      const exists = await ctx.resolveAgent(entry.agent);
      if (!exists) {
        errors.push({ level: "external", path: p(epath, "agent"), message: `Referenced agent '${entry.agent}' not found` });
      }
    }
  }
}

async function validateToolCallExternal(
  manifest: ToolAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  ctx: ValidationContext
): Promise<void> {
  if (manifest.tool.kind === "mcp") {
    try {
      const available = await ctx.resolveTools(manifest.tool.server!);
      if (!available.includes(manifest.tool.name)) {
        errors.push({
          level: "external",
          path: p(path, "tool.name"),
          message: `Tool '${manifest.tool.name}' not found on MCP server '${manifest.tool.server}'`,
        });
      }
    } catch (e) {
      const message = `Could not connect to MCP server: ${(e as Error).message}`;
      if (ctx.strict) {
        errors.push({ level: "external", path: p(path, "tool.server"), message });
      } else {
        warnings.push({ path: p(path, "tool.server"), message });
      }
    }
  }

  if (manifest.tool.kind === "local") {
    if (!ctx.localTools.includes(manifest.tool.name)) {
      errors.push({ level: "external", path: p(path, "tool.name"), message: `Local tool '${manifest.tool.name}' is not registered` });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function p(base: string, field: string): string {
  return base ? `${base}.${field}` : field;
}

function collectInputVars(manifest: AgentManifest): string[] {
  if (!manifest.inputSchema) return ["userQuery"];
  return Object.keys(manifest.inputSchema);
}

function getStepStateKey(step: StepRef): string {
  if (step.stateKey) return step.stateKey;
  if (step.agent?.stateKey) return step.agent.stateKey;
  if (step.ref) return normalizeId(step.ref);
  if (step.agent) return normalizeId(step.agent.id);
  return "unknown";
}

/**
 * Statically determine the set of keys an agent's output exposes.
 * Returns null when the shape is opaque (e.g. tool agents, LLMs without
 * outputSchema, sequentials without an output mapping resolving to a typed
 * step, ref children whose manifest is not in scope here).
 */
function getStaticOutputKeysFromManifest(manifest: AgentManifest | undefined): string[] | null {
  if (!manifest) return null;
  switch (manifest.kind) {
    case "llm":
      return manifest.outputSchema ? Object.keys(manifest.outputSchema) : null;
    case "tool":
      return null;
    case "sequential":
      if (manifest.output) return Object.keys(manifest.output);
      return null;
    case "parallel":
      if (manifest.output) return Object.keys(manifest.output);
      return manifest.branches.map((b) => getStepStateKey(b));
  }
}

function getStaticOutputKeys(step: StepRef): string[] | null {
  return getStaticOutputKeysFromManifest(step.agent);
}

/**
 * Cross-check a step's `input:` transform against the inline child agent's
 * `inputSchema`. The contract:
 *   - With an explicit `input:` block, its keys must equal the child's
 *     inputSchema keys (extras → error, missing → error).
 *   - Without an `input:` block, the child's inputSchema keys must be a
 *     subset of the upstream's static output keys (when knowable).
 * Children with no inputSchema declared are treated as `userQuery` and
 * skip these checks.
 */
function validateStepInputAgainstChild(
  step: StepRef,
  child: AgentManifest,
  upstreamKeys: string[] | null,
  stepPath: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const schemaKeys = child.inputSchema ? Object.keys(child.inputSchema) : null;

  if (step.input) {
    const inputKeys = Object.keys(step.input);
    if (!schemaKeys) {
      // Child has no inputSchema; transform values get coerced to a string.
      // Warn — the user is almost certainly missing an inputSchema.
      warnings.push({
        path: p(stepPath, "input"),
        message: `Step provides input keys [${inputKeys.join(", ")}] but child agent '${child.id}' has no inputSchema. Declare inputSchema to receive these as state.`,
      });
      return;
    }
    const schemaSet = new Set(schemaKeys);
    const inputSet = new Set(inputKeys);
    for (const k of inputKeys) {
      if (!schemaSet.has(k)) {
        errors.push({
          level: "reference",
          path: p(stepPath, `input.${k}`),
          message: `Input key '${k}' is not declared in child agent '${child.id}' inputSchema. Declared: ${schemaKeys.join(", ") || "(none)"}`,
        });
      }
    }
    for (const k of schemaKeys) {
      if (!inputSet.has(k)) {
        errors.push({
          level: "reference",
          path: p(stepPath, "input"),
          message: `Input transform is missing key '${k}' required by child agent '${child.id}' inputSchema`,
        });
      }
    }
    return;
  }

  // No explicit transform — default upstream feeds the child.
  if (!schemaKeys) return; // child takes a plain string; default upstream stringifies fine
  if (upstreamKeys === null) {
    warnings.push({
      path: stepPath,
      message: `No input transform and upstream output shape is unknown; cannot verify it satisfies child agent '${child.id}' inputSchema. Add an explicit 'input:' block.`,
    });
    return;
  }
  const upstreamSet = new Set(upstreamKeys);
  for (const k of schemaKeys) {
    if (!upstreamSet.has(k)) {
      errors.push({
        level: "reference",
        path: stepPath,
        message: `Default upstream does not provide key '${k}' required by child agent '${child.id}' inputSchema. Upstream provides: ${upstreamKeys.join(", ") || "(none)"}. Add an explicit 'input:' block.`,
      });
    }
  }
}
