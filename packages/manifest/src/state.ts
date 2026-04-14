import type { AgentManifest, AgentState, InputSchema, OutputMapping, StepRef } from "./types.js";
import { resolvePath, interpolate } from "./template.js";

/**
 * Normalize an agent ID into a valid state key.
 * "my-long-agent-name" → "myLongAgentName"
 */
export function normalizeId(id: string): string {
  return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Get the state key for a step: explicit stateKey on the step,
 * or explicit stateKey on the inline agent, or normalized agent id/ref.
 */
export function getStateKey(step: StepRef): string {
  if (step.stateKey) return step.stateKey;
  if (step.agent?.stateKey) return step.agent.stateKey;
  if (step.ref) return normalizeId(step.ref);
  if (step.agent) return normalizeId(step.agent.id);
  return "unknown";
}

/**
 * Returns true if this step is a reference (not inline).
 */
export function isRefStep(step: StepRef): step is StepRef & { ref: string } {
  return typeof step.ref === "string";
}

/**
 * Create initial state from input and an inputSchema.
 * If no inputSchema, wraps the raw input as { userQuery: input }.
 */
export function createInitialState(input: unknown, inputSchema?: InputSchema): AgentState {
  if (!inputSchema) {
    // Default: plain string input
    return { userQuery: typeof input === "string" ? input : String(input) };
  }

  // Structured input: input should be an object
  if (typeof input === "object" && input !== null) {
    const state: AgentState = {};
    for (const [key, def] of Object.entries(inputSchema)) {
      const provided = (input as Record<string, unknown>)[key];
      if (provided !== undefined) {
        state[key] = provided;
      } else {
        // Apply default if defined, otherwise null
        const defaultValue = typeof def === "object" ? def.default : undefined;
        state[key] = defaultValue ?? null;
      }
    }
    return state;
  }

  // inputSchema declared but input is a string — wrap as userQuery fallback
  return { userQuery: String(input) };
}

/**
 * Apply a step's input transform: maps parent state to child agent's input.
 * If no transform is provided, the child's input is the upstream value
 * (parent's input for the first step, the previous step's output otherwise).
 */
export function applyInputTransform(
  transform: Record<string, string> | undefined,
  parentState: AgentState,
  defaultUpstream: unknown
): unknown {
  if (!transform) return defaultUpstream;

  const result: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(transform)) {
    // If the template is a simple {{ref}}, resolve the value directly (preserving type)
    const simpleMatch = template.match(/^\{\{(.+?)\}\}$/);
    if (simpleMatch) {
      result[key] = resolvePath(parentState, simpleMatch[1].trim()) ?? null;
    } else {
      // Complex template with mixed text + refs: interpolate as string
      result[key] = interpolate(template, parentState);
    }
  }
  return result;
}

/**
 * Apply an output mapping: maps state values to output properties.
 * Supports nested output objects.
 */
export function applyOutputMapping(
  mapping: OutputMapping,
  state: AgentState
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === "string") {
      // Template reference
      const simpleMatch = value.match(/^\{\{(.+?)\}\}$/);
      if (simpleMatch) {
        result[key] = resolvePath(state, simpleMatch[1].trim()) ?? null;
      } else {
        result[key] = interpolate(value, state);
      }
    } else {
      // Nested object mapping
      result[key] = applyOutputMapping(value, state);
    }
  }
  return result;
}
