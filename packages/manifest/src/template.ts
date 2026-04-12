import type { AgentState } from "./types.js";

/**
 * Resolve a dotted path like "agentA.property.nested" against a state object.
 * Returns undefined if any segment is missing.
 */
export function resolvePath(state: AgentState, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = state;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Interpolate {{var}} references in a string, replacing them with state values.
 * Null/undefined values render as empty string.
 */
export function interpolate(template: string, state: AgentState): string {
  return template.replace(/\{\{([^#/}][^}]*?)\}\}/g, (_match, path: string) => {
    const value = resolvePath(state, path.trim());
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Process {{#if ...}} / {{/if}} conditional blocks, then interpolate variables.
 *
 * Supports:
 *   {{#if varName}}        -- truthiness check
 *   {{#if varName == val}} -- equality
 *   {{#if varName != val}} -- inequality
 */
export function renderTemplate(template: string, state: AgentState): string {
  const processed = processConditionals(template, state);
  return interpolate(processed, state);
}

function processConditionals(template: string, state: AgentState): string {
  return parseAndProcessBlocks(template, state);
}

/**
 * Parse {{#if}} blocks with proper nesting by tracking depth.
 */
function parseAndProcessBlocks(template: string, state: AgentState): string {
  const OPEN = "{{#if ";
  const CLOSE = "{{/if}}";
  let result = "";
  let i = 0;

  while (i < template.length) {
    const openIdx = template.indexOf(OPEN, i);
    if (openIdx === -1) {
      result += template.slice(i);
      break;
    }

    // Add text before the block
    result += template.slice(i, openIdx);

    // Find the closing tag for the condition
    const condEnd = template.indexOf("}}", openIdx + OPEN.length);
    if (condEnd === -1) {
      result += template.slice(openIdx);
      break;
    }

    const condition = template.slice(openIdx + OPEN.length, condEnd).trim();
    const bodyStart = condEnd + 2;

    // Find matching {{/if}} respecting nesting
    let depth = 1;
    let j = bodyStart;
    while (j < template.length && depth > 0) {
      const nextOpen = template.indexOf(OPEN, j);
      const nextClose = template.indexOf(CLOSE, j);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        j = nextOpen + OPEN.length;
      } else {
        depth--;
        if (depth === 0) {
          const body = template.slice(bodyStart, nextClose);
          if (evaluateIfCondition(condition, state)) {
            // Recursively process the body for nested blocks
            result += parseAndProcessBlocks(body, state);
          }
          i = nextClose + CLOSE.length;
          break;
        }
        j = nextClose + CLOSE.length;
      }
    }

    if (depth > 0) {
      // Unmatched block, output as-is
      result += template.slice(openIdx);
      break;
    }
  }

  return result;
}

function evaluateIfCondition(condition: string, state: AgentState): boolean {
  // Check for == or !=
  const eqMatch = condition.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
  if (eqMatch) {
    const left = resolveConditionValue(eqMatch[1].trim(), state);
    const right = parseConditionLiteral(eqMatch[3].trim());
    if (eqMatch[2] === "==") return left == right;
    return left != right;
  }

  // Truthiness check: {{#if varName}}
  const value = resolvePath(state, condition);
  return isTruthy(value);
}

function resolveConditionValue(expr: string, state: AgentState): unknown {
  // If it looks like a template var reference (no quotes), resolve from state
  if (!expr.startsWith('"') && !expr.startsWith("'")) {
    return resolvePath(state, expr);
  }
  return parseConditionLiteral(expr);
}

function parseConditionLiteral(value: string): unknown {
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!Number.isNaN(num)) return num;
  // Bare string (e.g. "en" in {{#if language != en}})
  return value;
}

export function isTruthy(value: unknown): boolean {
  if (value == null) return false;
  if (value === "") return false;
  if (value === 0) return false;
  if (value === false) return false;
  return true;
}
