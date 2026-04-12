import type { AgentState } from "./types.js";
import { resolvePath, isTruthy } from "./template.js";

/**
 * Evaluate a condition expression against state.
 *
 * Supports:
 *   "{{var}}"                          — truthiness
 *   "{{var}} == value"                 — equality
 *   "{{var}} != value"                 — inequality
 *   "{{var}} > value"                  — comparison
 *   "{{var}} >= value"                 — comparison
 *   "{{expr1}} && {{expr2}}"           — logical AND
 *   "{{expr1}} || {{expr2}}"           — logical OR
 */
export function evaluateCondition(expression: string, state: AgentState): boolean {
  // Handle compound expressions (&&, ||)
  // Split on || first (lower precedence), then &&
  if (expression.includes("||")) {
    const parts = splitOnOperator(expression, "||");
    return parts.some((part) => evaluateCondition(part.trim(), state));
  }

  if (expression.includes("&&")) {
    const parts = splitOnOperator(expression, "&&");
    return parts.every((part) => evaluateCondition(part.trim(), state));
  }

  // Single expression
  return evaluateSingle(expression.trim(), state);
}

function evaluateSingle(expr: string, state: AgentState): boolean {
  // Try comparison operators: >=, <=, !=, ==, >, <
  for (const op of [">=", "<=", "!=", "==", ">", "<"] as const) {
    const idx = expr.indexOf(op);
    if (idx !== -1) {
      const left = resolveValue(expr.slice(0, idx).trim(), state);
      const right = resolveValue(expr.slice(idx + op.length).trim(), state);
      return compare(left, right, op);
    }
  }

  // No operator: truthiness check
  const value = resolveValue(expr, state);
  return isTruthy(value);
}

function resolveValue(expr: string, state: AgentState): unknown {
  // Strip {{}} wrapper if present
  const match = expr.match(/^\{\{(.+?)\}\}$/);
  if (match) {
    return resolvePath(state, match[1].trim());
  }

  // Literal value
  return parseLiteral(expr);
}

function parseLiteral(value: string): unknown {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!Number.isNaN(num)) return num;
  return value;
}

function compare(left: unknown, right: unknown, op: ">=" | "<=" | "!=" | "==" | ">" | "<"): boolean {
  switch (op) {
    case "==":
      return left == right;
    case "!=":
      return left != right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
  }
}

/**
 * Split on a logical operator, respecting {{}} boundaries.
 */
function splitOnOperator(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "{" && expr[i + 1] === "{") {
      depth++;
      current += "{{";
      i++;
    } else if (expr[i] === "}" && expr[i + 1] === "}") {
      depth--;
      current += "}}";
      i++;
    } else if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = "";
      i += op.length - 1;
    } else {
      current += expr[i];
    }
  }
  parts.push(current);
  return parts;
}
