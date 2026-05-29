import { parse as parseYAML } from "yaml";
import {
  fetchWithOutboundPolicy,
  parseAgentRef,
  validateOutboundUrl,
  type OutboundUrlPolicyOptions,
} from "@agntz/core";
import { normalizeManifest } from "./parser.js";
import { normalizeId } from "./state.js";
import { parseUrlPlaceholders } from "./http-url.js";
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
  ResourceManifestEntry,
} from "./types.js";

const HTTP_TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const RESOURCE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const SECRET_REF_RE = /\{\{\s*secrets\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const ENV_REF_RE = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function validateOutboundUrlStructural(
  rawUrl: string,
  path: string,
  label: string,
  errors: ValidationError[],
): void {
  try {
    validateOutboundUrl(rawUrl);
  } catch (err) {
    const error = err as Error & { code?: string };
    const message = error.code === "invalid_url"
      ? `${label} is not a valid URL: '${rawUrl}'`
      : `${label} is not an allowed outbound URL: ${error.message}`;
    errors.push({ level: "structural", path, message });
  }
}

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
  /** Check whether a skill name exists in the user's SkillStore. */
  resolveSkill?: (name: string) => Promise<boolean>;
  /**
   * Check whether a secret exists for the current user. Used by the HTTP tool
   * validator to emit warnings for `{{secrets.<name>}}` references that
   * cannot be resolved at save time. Always a warning — users may add the
   * secret later before invoking.
   */
  resolveSecret?: (name: string) => Promise<boolean>;
  /**
   * Check whether an env var is available. Used by the HTTP tool validator
   * to emit warnings for `{{env.<NAME>}}` references that aren't set in the
   * resolution environment (typically `process.env` for embedded runs).
   * Always a warning — env may be set later before invoking.
   */
  resolveEnv?: (name: string) => Promise<boolean>;
  /**
   * When true, MCP server connection failures are reported as errors
   * instead of warnings. Use for save-time validation where an unreachable
   * server should block persistence; leave false for live-editor validation
   * where transient network issues shouldn't flood the editor with errors.
   */
  strict?: boolean;
  /** Override outbound URL policy for external liveness probes. */
  outboundUrlPolicy?: OutboundUrlPolicyOptions;
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

  if (manifest.prompt !== undefined) {
    if (typeof manifest.prompt !== "string") {
      errors.push({ level: "structural", path: p(path, "prompt"), message: "LLM agent 'prompt' must be a string when present" });
    } else {
      validateTemplatesSyntax(manifest.prompt, p(path, "prompt"), errors);
    }
  }

  if (manifest.outputSchema) {
    validatePropertySchema(manifest.outputSchema, p(path, "outputSchema"), errors);
  }

  if (manifest.resources) {
    validateResources(manifest.resources, p(path, "resources"), errors);
  }

  if (manifest.tools) {
    validateToolEntries(manifest.tools, p(path, "tools"), errors, manifest.resources);
  }

  if (manifest.spawnable) {
    validateSpawnableStructural(manifest, p(path, "spawnable"), errors, warnings);
  }

  if (manifest.skills) {
    validateSkillsStructural(manifest.skills, p(path, "skills"), errors);
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
  if (!manifest.tool.kind || !["mcp", "local", "http"].includes(manifest.tool.kind)) {
    errors.push({ level: "structural", path: p(path, "tool.kind"), message: "tool.kind must be 'mcp', 'local', or 'http'" });
  }
  if (!manifest.tool.name) {
    errors.push({ level: "structural", path: p(path, "tool.name"), message: "tool.name is required" });
  } else if (manifest.tool.kind === "http" && !HTTP_TOOL_NAME_RE.test(manifest.tool.name)) {
    errors.push({
      level: "structural",
      path: p(path, "tool.name"),
      message: `HTTP tool name '${manifest.tool.name}' must match ${HTTP_TOOL_NAME_RE.source}`,
    });
  }
  if (manifest.tool.kind === "mcp" && !manifest.tool.server) {
    errors.push({ level: "structural", path: p(path, "tool.server"), message: "MCP tool must have a server URL" });
  }
  if (manifest.tool.kind === "http") {
    if (!manifest.tool.url || typeof manifest.tool.url !== "string") {
      errors.push({ level: "structural", path: p(path, "tool.url"), message: "HTTP tool must have a url string" });
    } else {
      const stub = manifest.tool.url.replace(/\{[^}]+\}/g, "_");
      validateOutboundUrlStructural(
        stub,
        p(path, "tool.url"),
        "HTTP tool url",
        errors,
      );
    }
    const method = manifest.tool.method ?? "GET";
    if (method !== "GET") {
      errors.push({
        level: "structural",
        path: p(path, "tool.method"),
        message: `HTTP tool method must be 'GET' — only GET is supported in this release.`,
      });
    }
    if (manifest.tool.headers) {
      for (const [key, val] of Object.entries(manifest.tool.headers)) {
        if (typeof val !== "string") {
          errors.push({ level: "structural", path: p(path, `tool.headers.${key}`), message: "Header values must be strings (template expressions)" });
        } else {
          validateTemplatesSyntax(val, p(path, `tool.headers.${key}`), errors);
        }
      }
    }
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
  } else if (typeof step.ref === "string" && step.ref.includes("@")) {
    try {
      parseAgentRef(step.ref);
    } catch (err) {
      errors.push({ level: "structural", path: p(path, "ref"), message: (err as Error).message });
    }
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

function validateSpawnableStructural(
  parent: LLMAgentManifest,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const seenIds = new Set<string>();
  for (let i = 0; i < parent.spawnable!.length; i++) {
    const ref = parent.spawnable![i];
    const epath = `${path}[${i}]`;

    if (ref.kind !== "ref" && ref.kind !== "inline") {
      errors.push({ level: "structural", path: epath, message: "spawnable entry must have kind 'ref' or 'inline'" });
      continue;
    }

    if (ref.kind === "ref") {
      if (!ref.agentId || typeof ref.agentId !== "string") {
        errors.push({ level: "structural", path: p(epath, "agentId"), message: "ref entry must have an agentId string" });
        continue;
      }
      if (ref.agentId === parent.id) {
        errors.push({ level: "reference", path: p(epath, "agentId"), message: `spawnable cannot reference self ('${parent.id}')` });
      }
      if (seenIds.has(ref.agentId)) {
        warnings.push({ path: p(epath, "agentId"), message: `duplicate spawnable agentId '${ref.agentId}'` });
      }
      seenIds.add(ref.agentId);
      if (ref.version !== undefined) {
        if (typeof ref.version !== "string") {
          errors.push({ level: "structural", path: p(epath, "version"), message: "version must be a string" });
        } else {
          try {
            parseAgentRef(`${ref.agentId}@${ref.version}`);
          } catch (err) {
            errors.push({ level: "structural", path: p(epath, "version"), message: (err as Error).message });
          }
        }
      }
    } else {
      const def = ref.definition;
      if (!def) {
        errors.push({ level: "structural", path: p(epath, "definition"), message: "inline entry must have a definition" });
        continue;
      }
      if (def.id === parent.id) {
        errors.push({ level: "reference", path: p(epath, "definition.id"), message: `inline spawnable cannot reuse parent id ('${parent.id}')` });
      }
      // Spawn callbacks pre-register the child's instruction as a static
      // systemPrompt — Phase 1 doesn't re-render templates per spawn call.
      if (def.instruction && /\{\{[^}]+\}\}/.test(def.instruction)) {
        errors.push({
          level: "structural",
          path: p(epath, "definition.instruction"),
          message: "spawnable inline child instruction must not contain template variables ({{...}}) — children are pre-registered with static systemPrompts. Use inputSchema + a static prompt that references the spawn input as the user message.",
        });
      }
      validateStructural(def, p(epath, "definition"), errors, warnings);
    }
  }
}

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Structural check for an agent's `skills:` array — string entries with kebab-case names.
function validateSkillsStructural(
  skills: unknown,
  path: string,
  errors: ValidationError[]
): void {
  if (!Array.isArray(skills)) {
    errors.push({ level: "structural", path, message: "skills must be an array of strings" });
    return;
  }
  for (let i = 0; i < skills.length; i++) {
    const name = skills[i];
    const epath = `${path}[${i}]`;
    if (typeof name !== "string") {
      errors.push({ level: "structural", path: epath, message: `skill name must be a string (got ${typeof name})` });
      continue;
    }
    if (!SKILL_NAME_RE.test(name)) {
      errors.push({
        level: "structural",
        path: epath,
        message: `skill name '${name}' must match ${SKILL_NAME_RE.source}`,
      });
    }
  }
}

// Structural check for a manifest `tools:` array (LLM agent or skill).
export function validateToolEntries(
  tools: ManifestToolEntry[],
  path: string,
  errors: ValidationError[],
  resources?: Record<string, ResourceManifestEntry>,
): void {
  const reservedResourcePrefixes = resourceToolPrefixes(resources);
  for (let i = 0; i < tools.length; i++) {
    const entry = tools[i];
    const epath = `${path}[${i}]`;

    if (!entry.kind || !["mcp", "local", "agent", "http"].includes(entry.kind)) {
      errors.push({ level: "structural", path: epath, message: "Tool entry must have kind: mcp, local, agent, or http" });
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
      // headers — only meaningful when `server` is a raw URL; values must be
      // strings with syntactically valid templates ({{secrets.X}} etc.).
      if (entry.headers) {
        for (const [key, val] of Object.entries(entry.headers)) {
          if (typeof val !== "string") {
            errors.push({
              level: "structural",
              path: p(epath, `headers.${key}`),
              message: "Header values must be strings (template expressions)",
            });
          } else {
            validateTemplatesSyntax(val, p(epath, `headers.${key}`), errors);
          }
        }
      }
    }

    if (entry.kind === "local") {
      if (!entry.tools || entry.tools.length === 0) {
        errors.push({ level: "structural", path: epath, message: "Local tool entry must list at least one tool" });
      } else {
        for (let j = 0; j < entry.tools.length; j++) {
          const name = entry.tools[j];
          if (typeof name !== "string") {
            errors.push({ level: "structural", path: `${epath}.tools[${j}]`, message: "Local tool name must be a string" });
            continue;
          }
          for (const prefix of reservedResourcePrefixes) {
            if (name.startsWith(prefix)) {
              errors.push({
                level: "structural",
                path: `${epath}.tools[${j}]`,
                message: `Local tool '${name}' conflicts with reserved resource tool prefix '${prefix}'`,
              });
            }
          }
        }
      }
    }

    if (entry.kind === "agent") {
      if (!entry.agent) {
        errors.push({ level: "structural", path: p(epath, "agent"), message: "Agent tool entry must reference an agent ID" });
      } else if (entry.version !== undefined) {
        if (typeof entry.version !== "string") {
          errors.push({ level: "structural", path: p(epath, "version"), message: "version must be a string" });
        } else if (entry.agent.includes("@")) {
          errors.push({
            level: "structural",
            path: p(epath, "version"),
            message: "agent tool entry must not combine an '@version' suffix in 'agent' with a separate 'version' field",
          });
        } else {
          try {
            parseAgentRef(`${entry.agent}@${entry.version}`);
          } catch (err) {
            errors.push({ level: "structural", path: p(epath, "version"), message: (err as Error).message });
          }
        }
      } else if (entry.agent.includes("@")) {
        try {
          parseAgentRef(entry.agent);
        } catch (err) {
          errors.push({ level: "structural", path: p(epath, "agent"), message: (err as Error).message });
        }
      }
    }

    if (entry.kind === "http") {
      // Name — programming-identifier style; becomes http__<name> for the LLM.
      if (!entry.name || typeof entry.name !== "string") {
        errors.push({ level: "structural", path: p(epath, "name"), message: "HTTP tool entry must have a name string" });
      } else if (!HTTP_TOOL_NAME_RE.test(entry.name)) {
        errors.push({
          level: "structural",
          path: p(epath, "name"),
          message: `HTTP tool name '${entry.name}' must match ${HTTP_TOOL_NAME_RE.source}`,
        });
      }

      // URL — required, must parse once placeholders are stubbed.
      if (!entry.url || typeof entry.url !== "string") {
        errors.push({ level: "structural", path: p(epath, "url"), message: "HTTP tool entry must have a url string" });
      } else {
        const stub = entry.url.replace(/\{[^}]+\}/g, "_");
        validateOutboundUrlStructural(stub, p(epath, "url"), "HTTP tool url", errors);
      }

      // Method — GET/POST/PUT/PATCH/DELETE.
      const method = entry.method ?? "GET";
      const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      if (!allowedMethods.includes(method)) {
        errors.push({
          level: "structural",
          path: p(epath, "method"),
          message: `HTTP tool method must be one of ${allowedMethods.join(", ")}; got '${method}'.`,
        });
      }
      const methodHasBody = method === "POST" || method === "PUT" || method === "PATCH";

      // Placeholders — `{X?}` only legal in query string.
      let placeholderNames: Set<string> = new Set();
      if (entry.url && typeof entry.url === "string") {
        const placeholders = parseUrlPlaceholders(entry.url);
        for (const ph of placeholders) {
          placeholderNames.add(ph.name);
          if (ph.position === "path" && ph.optional) {
            errors.push({
              level: "structural",
              path: p(epath, "url"),
              message: `Optional placeholders ({${ph.name}?}) are only allowed in the query string.`,
            });
          }
        }
      }

      // params — keys must correspond to URL placeholders; values must have
      // syntactically valid templates.
      if (entry.params) {
        for (const [key, val] of Object.entries(entry.params)) {
          if (!placeholderNames.has(key)) {
            errors.push({
              level: "structural",
              path: p(epath, `params.${key}`),
              message: `params.${key} does not correspond to a URL placeholder.`,
            });
          }
          if (typeof val !== "string") {
            errors.push({
              level: "structural",
              path: p(epath, `params.${key}`),
              message: "HTTP tool param values must be strings (template expressions).",
            });
          } else {
            validateTemplatesSyntax(val, p(epath, `params.${key}`), errors);
          }
        }
      }

      // headers — values must have syntactically valid templates.
      if (entry.headers) {
        for (const [key, val] of Object.entries(entry.headers)) {
          if (typeof val !== "string") {
            errors.push({
              level: "structural",
              path: p(epath, `headers.${key}`),
              message: "HTTP tool header values must be strings (template expressions).",
            });
          } else {
            validateTemplatesSyntax(val, p(epath, `headers.${key}`), errors);
          }
        }
      }

      // body / body_type — only meaningful for methods that accept a body.
      if (entry.body !== undefined) {
        if (!methodHasBody) {
          errors.push({
            level: "structural",
            path: p(epath, "body"),
            message: `HTTP tool body is not allowed for method '${method}'.`,
          });
        }
        validateBodyTemplates(entry.body, entry.body_type, p(epath, "body"), errors);
      }
      if (entry.body_type !== undefined) {
        const allowed = ["json", "form", "query"];
        if (!allowed.includes(entry.body_type as string)) {
          errors.push({
            level: "structural",
            path: p(epath, "body_type"),
            message: `body_type must be one of ${allowed.join(", ")}`,
          });
        }
      }

      // auth — discriminated union, optional.
      if (entry.auth !== undefined) {
        validateHttpAuth(entry.auth, p(epath, "auth"), errors);
      }
    }
  }
}

function validateResources(
  resources: Record<string, ResourceManifestEntry>,
  path: string,
  errors: ValidationError[],
): void {
  for (const [name, entry] of Object.entries(resources)) {
    const epath = p(path, name);
    if (!RESOURCE_NAME_RE.test(name)) {
      errors.push({
        level: "structural",
        path: epath,
        message: `Resource name '${name}' must match ${RESOURCE_NAME_RE.source}`,
      });
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({ level: "structural", path: epath, message: "Resource entry must be an object" });
      continue;
    }
    if (!entry.kind || typeof entry.kind !== "string") {
      errors.push({ level: "structural", path: p(epath, "kind"), message: "Resource kind must be a string" });
    } else if (!RESOURCE_NAME_RE.test(entry.kind)) {
      errors.push({
        level: "structural",
        path: p(epath, "kind"),
        message: `Resource kind '${entry.kind}' must match ${RESOURCE_NAME_RE.source}`,
      });
    }
    if (entry.mode !== undefined && entry.mode !== "read" && entry.mode !== "read-write") {
      errors.push({ level: "structural", path: p(epath, "mode"), message: "Resource mode must be 'read' or 'read-write'" });
    }
    if (entry.namespace !== undefined) {
      const namespace = entry.namespace;
      if (typeof namespace === "string") {
        // ok
      } else if (Array.isArray(namespace) && namespace.every((v) => typeof v === "string")) {
        // ok
      } else {
        errors.push({
          level: "structural",
          path: p(epath, "namespace"),
          message: "Resource namespace must be a string or array of strings",
        });
      }
    }
  }
}

function resourceToolPrefixes(resources: Record<string, ResourceManifestEntry> | undefined): string[] {
  return Object.keys(resources ?? {}).map((name) => `${resourceToolPrefix(name)}_`);
}

function resourceToolPrefix(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ─── HTTP body / auth helpers ────────────────────────────────────────

function validateBodyTemplates(
  body: unknown,
  bodyType: string | undefined,
  path: string,
  errors: ValidationError[],
): void {
  if (bodyType === "form" || bodyType === "query") {
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      errors.push({
        level: "structural",
        path,
        message: `body must be a flat object of string values when body_type is '${bodyType}'.`,
      });
      return;
    }
    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
      if (typeof val !== "string") {
        errors.push({
          level: "structural",
          path: p(path, key),
          message: `body.${key} must be a string when body_type is '${bodyType}'.`,
        });
      } else {
        validateTemplatesSyntax(val, p(path, key), errors);
      }
    }
    return;
  }
  // JSON (default): walk recursively, validating every string leaf.
  walkBodyJSON(body, path, errors);
}

function walkBodyJSON(node: unknown, path: string, errors: ValidationError[]): void {
  if (typeof node === "string") {
    validateTemplatesSyntax(node, path, errors);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkBodyJSON(v, p(path, String(i)), errors));
    return;
  }
  if (node != null && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkBodyJSON(v, p(path, k), errors);
    }
  }
}

function validateHttpAuth(auth: unknown, path: string, errors: ValidationError[]): void {
  if (auth == null || typeof auth !== "object") {
    errors.push({ level: "structural", path, message: "auth must be an object" });
    return;
  }
  const a = auth as Record<string, unknown>;
  if (typeof a.type !== "string") {
    errors.push({ level: "structural", path: p(path, "type"), message: "auth.type is required" });
    return;
  }
  if (a.type === "oauth2_client_credentials") {
    validateOAuth2ClientCredentials(a, path, errors);
    return;
  }
  if (a.type === "token_exchange") {
    validateTokenExchange(a, path, errors);
    return;
  }
  errors.push({
    level: "structural",
    path: p(path, "type"),
    message: `auth.type must be 'oauth2_client_credentials' or 'token_exchange'; got '${a.type}'.`,
  });
}

function validateOAuth2ClientCredentials(
  a: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): void {
  for (const field of ["token_url", "client_id", "client_secret"] as const) {
    const val = a[field];
    if (typeof val !== "string" || val.length === 0) {
      errors.push({
        level: "structural",
        path: p(path, field),
        message: `auth.${field} is required for oauth2_client_credentials`,
      });
    }
  }
  if (typeof a.token_url === "string") {
    validateOutboundUrlStructural(
      a.token_url,
      p(path, "token_url"),
      "auth.token_url",
      errors,
    );
  }
  for (const field of ["client_id", "client_secret", "scope"] as const) {
    if (typeof a[field] === "string") {
      validateTemplatesSyntax(a[field] as string, p(path, field), errors);
    }
  }
  if (a.creds_location !== undefined && a.creds_location !== "basic_header" && a.creds_location !== "body") {
    errors.push({
      level: "structural",
      path: p(path, "creds_location"),
      message: `auth.creds_location must be 'basic_header' or 'body'.`,
    });
  }
  validateRefreshOn(a.refresh_on, path, errors);
  validateCacheTtl(a.cache_ttl, path, errors);
}

function validateTokenExchange(
  a: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): void {
  // request
  const req = a.request as Record<string, unknown> | undefined;
  if (!req || typeof req !== "object") {
    errors.push({ level: "structural", path: p(path, "request"), message: "auth.request is required" });
  } else {
    if (typeof req.url !== "string" || req.url.length === 0) {
      errors.push({
        level: "structural",
        path: p(path, "request.url"),
        message: "auth.request.url is required",
      });
    } else {
      validateOutboundUrlStructural(
        req.url,
        p(path, "request.url"),
        "auth.request.url",
        errors,
      );
    }
    const reqMethod = (req.method ?? "POST") as string;
    if (!["GET", "POST", "PUT", "PATCH"].includes(reqMethod)) {
      errors.push({
        level: "structural",
        path: p(path, "request.method"),
        message: `auth.request.method must be one of GET, POST, PUT, PATCH`,
      });
    }
    if (req.headers !== undefined) {
      if (typeof req.headers !== "object" || req.headers === null) {
        errors.push({
          level: "structural",
          path: p(path, "request.headers"),
          message: "auth.request.headers must be an object",
        });
      } else {
        for (const [k, v] of Object.entries(req.headers as Record<string, unknown>)) {
          if (typeof v !== "string") {
            errors.push({
              level: "structural",
              path: p(path, `request.headers.${k}`),
              message: "auth.request.headers values must be strings",
            });
          } else {
            validateTemplatesSyntax(v, p(path, `request.headers.${k}`), errors);
          }
        }
      }
    }
    if (req.body_type !== undefined && !["json", "form", "query"].includes(req.body_type as string)) {
      errors.push({
        level: "structural",
        path: p(path, "request.body_type"),
        message: "auth.request.body_type must be one of json, form, query",
      });
    }
    if (req.body !== undefined) {
      validateBodyTemplates(req.body, req.body_type as string | undefined, p(path, "request.body"), errors);
    }
  }
  // extract
  const ext = a.extract as Record<string, unknown> | undefined;
  if (!ext || typeof ext !== "object") {
    errors.push({ level: "structural", path: p(path, "extract"), message: "auth.extract is required" });
  } else {
    if (ext.response_format !== undefined && ext.response_format !== "json" && ext.response_format !== "text") {
      errors.push({
        level: "structural",
        path: p(path, "extract.response_format"),
        message: "auth.extract.response_format must be 'json' or 'text'.",
      });
    }
    const isText = ext.response_format === "text";
    if (!isText) {
      if (typeof ext.token_path !== "string" || ext.token_path.length === 0) {
        errors.push({
          level: "structural",
          path: p(path, "extract.token_path"),
          message: "auth.extract.token_path is required for JSON responses",
        });
      } else if (!ext.token_path.startsWith("$")) {
        errors.push({
          level: "structural",
          path: p(path, "extract.token_path"),
          message: "auth.extract.token_path must be a JSONPath starting with '$'.",
        });
      }
    }
    if (ext.expires_path !== undefined) {
      if (typeof ext.expires_path !== "string" || !ext.expires_path.startsWith("$")) {
        errors.push({
          level: "structural",
          path: p(path, "extract.expires_path"),
          message: "auth.extract.expires_path must be a JSONPath starting with '$'.",
        });
      }
    }
  }
  // apply
  const app = a.apply as Record<string, unknown> | undefined;
  if (app && typeof app === "object") {
    if (app.location !== undefined && app.location !== "header" && app.location !== "query") {
      errors.push({
        level: "structural",
        path: p(path, "apply.location"),
        message: "auth.apply.location must be 'header' or 'query'.",
      });
    }
    if (app.location === "query" && (typeof app.name !== "string" || app.name.length === 0)) {
      errors.push({
        level: "structural",
        path: p(path, "apply.name"),
        message: "auth.apply.name is required when apply.location is 'query'.",
      });
    }
    if (app.format !== undefined) {
      if (typeof app.format !== "string" || !app.format.includes("{token}")) {
        errors.push({
          level: "structural",
          path: p(path, "apply.format"),
          message: "auth.apply.format must be a string containing the literal '{token}'.",
        });
      }
    }
  }
  validateRefreshOn(a.refresh_on, path, errors);
  validateCacheTtl(a.cache_ttl, path, errors);
}

function validateRefreshOn(val: unknown, path: string, errors: ValidationError[]): void {
  if (val === undefined) return;
  if (!Array.isArray(val) || val.some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 100 || n > 599)) {
    errors.push({
      level: "structural",
      path: p(path, "refresh_on"),
      message: "auth.refresh_on must be an array of HTTP status code integers (100-599).",
    });
  }
}

function validateCacheTtl(val: unknown, path: string, errors: ValidationError[]): void {
  if (val === undefined) return;
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) {
    errors.push({
      level: "structural",
      path: p(path, "cache_ttl"),
      message: "auth.cache_ttl must be a positive number (seconds).",
    });
  }
}

/**
 * Collect `{{secrets.<name>}}` references from the params/headers of an HTTP
 * tool entry. Used by the external validator to warn on missing secrets.
 */
function collectHttpSecretRefs(entry: {
  params?: Record<string, string>;
  headers?: Record<string, string>;
}): Set<string> {
  return collectHttpTemplateRefs(entry, SECRET_REF_RE);
}

/**
 * Collect `{{env.<NAME>}}` references from the params/headers of an HTTP
 * tool entry. Used by the external validator to warn on missing env vars.
 */
function collectHttpEnvRefs(entry: {
  params?: Record<string, string>;
  headers?: Record<string, string>;
}): Set<string> {
  return collectHttpTemplateRefs(entry, ENV_REF_RE);
}

function collectHttpTemplateRefs(
  entry: {
    params?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
    auth?: unknown;
  },
  re: RegExp,
): Set<string> {
  const names = new Set<string>();
  const scan = (val: unknown) => {
    if (typeof val === "string") {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(val)) !== null) {
        names.add(m[1]);
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) scan(v);
      return;
    }
    if (val != null && typeof val === "object") {
      for (const v of Object.values(val as Record<string, unknown>)) scan(v);
    }
  };
  if (entry.params) scan(entry.params);
  if (entry.headers) scan(entry.headers);
  if (entry.body !== undefined) scan(entry.body);
  if (entry.auth !== undefined) scan(entry.auth);
  return names;
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
      if (manifest.prompt) {
        validateTemplateRefs(manifest.prompt, availableVars, p(path, "prompt"), errors, warnings);
      }
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
      if (manifest.spawnable) {
        await validateSpawnableExternal(manifest.spawnable, p(path, "spawnable"), errors, ctx);
      }
      if (manifest.skills && ctx.resolveSkill) {
        for (let i = 0; i < manifest.skills.length; i++) {
          const name = manifest.skills[i];
          const exists = await ctx.resolveSkill(name);
          if (!exists) {
            errors.push({
              level: "external",
              path: `${p(path, "skills")}[${i}]`,
              message: `Skill '${name}' not found in store`,
            });
          }
        }
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

async function validateSpawnableExternal(
  spawnable: NonNullable<LLMAgentManifest["spawnable"]>,
  path: string,
  errors: ValidationError[],
  ctx: ValidationContext,
): Promise<void> {
  for (let i = 0; i < spawnable.length; i++) {
    const ref = spawnable[i];
    if (ref.kind !== "ref") continue;
    const exists = await ctx.resolveAgent(ref.agentId);
    if (!exists) {
      errors.push({
        level: "external",
        path: p(`${path}[${i}]`, "agentId"),
        message: `Spawnable agent '${ref.agentId}' not found in store`,
      });
    }
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

// External / reference-integrity check for a manifest `tools:` array.
export async function validateToolEntriesExternal(
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

    if (entry.kind === "http") {
      // Liveness probe — stub placeholders to make the URL syntactically valid,
      // never substitute real values (avoids leaking through logs).
      if (entry.url && typeof entry.url === "string") {
        const stubUrl = entry.url.replace(/\{[^}]+\}/g, "_");
        let probeError: Error | null = null;
        try {
          let probe = await fetchWithOutboundPolicy(
            stubUrl,
            {
              method: "HEAD",
              signal: AbortSignal.timeout(5000),
            },
            { policy: ctx.outboundUrlPolicy },
          );
          // Some servers refuse HEAD outright with 405 — try OPTIONS as a fallback.
          if (probe.status === 405) {
            probe = await fetchWithOutboundPolicy(
              stubUrl,
              {
                method: "OPTIONS",
                signal: AbortSignal.timeout(5000),
              },
              { policy: ctx.outboundUrlPolicy },
            );
          }
          // Any HTTP response — including 401/403/404 — means "alive". No-op.
          void probe;
        } catch (e) {
          probeError = e as Error;
        }
        if (probeError) {
          const message = `Could not reach HTTP endpoint '${entry.url}': ${probeError.message}`;
          if (ctx.strict) {
            errors.push({ level: "external", path: p(epath, "url"), message });
          } else {
            warnings.push({ path: p(epath, "url"), message });
          }
        }
      }

      // Secret references — warn (never error) on missing secrets.
      if (ctx.resolveSecret) {
        const refs = collectHttpSecretRefs(entry);
        for (const name of refs) {
          const exists = await ctx.resolveSecret(name);
          if (!exists) {
            warnings.push({
              path: epath,
              message: `Secret '${name}' referenced by '{{secrets.${name}}}' does not exist yet. Add it under Settings > Secrets before invoking this agent.`,
            });
          }
        }
      }

      // Env-var references — warn (never error) on missing env.
      if (ctx.resolveEnv) {
        const refs = collectHttpEnvRefs(entry);
        for (const name of refs) {
          const exists = await ctx.resolveEnv(name);
          if (!exists) {
            warnings.push({
              path: epath,
              message: `Env var '${name}' referenced by '{{env.${name}}}' is not set in the resolution environment. Set it before invoking this agent.`,
            });
          }
        }
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
