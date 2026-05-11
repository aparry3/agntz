import type { Catalog } from "./use-catalog";
import { AGENT_KINDS, TOOL_ENTRY_KINDS, SPAWNABLE_KINDS, PROPERTY_TYPES } from "./manifest-catalog";

export interface Suggestion {
  value: string;
  hint?: string;
}

export interface YamlContext {
  /** Path of keys / "[]" from the root to the value being edited. */
  path: string[];
  /** The key on the current line (when completing the value of `key:`). */
  currentKey: string | null;
  /** Value text already typed after `key: ` (or after `- `). */
  valuePrefix: string;
  /** True when the caret is on a bare scalar array item ("- " with no key:value). */
  isArrayItemValue: boolean;
  /** Siblings in the immediate mapping the caret is in (the not-yet-committed line). */
  scopeSiblings: Record<string, string>;
  /** Siblings of the array's container, when the caret is on an array item. */
  parentSiblings: Record<string, string>;
}

interface Scope {
  /** Column where keys of this mapping live. */
  indent: number;
  /** Path of keys / "[]" from the root to this mapping. */
  path: string[];
  /** Keys and their raw value strings observed so far. */
  siblings: Record<string, string>;
  /**
   * The most recent key in this scope whose value was empty (a block opener).
   * Used to determine the parent key when the next line descends into a
   * nested mapping or array.
   */
  lastEmptyKey: string | null;
}

const KEY_VALUE_RE = /^([A-Za-z_][\w$.-]*)\s*:\s*(.*)$/;

/**
 * Parse the YAML around the caret well enough to know what's being typed.
 * Indentation-based — handles `-` array items and nested mappings without a
 * full YAML parse. Comments and empty lines are ignored.
 */
export function parseYamlContext(value: string, caret: number): YamlContext | null {
  if (caret < 0 || caret > value.length) return null;

  const beforeCaret = value.slice(0, caret);
  const linesBefore = beforeCaret.split("\n");
  const currentLine = linesBefore[linesBefore.length - 1] ?? "";
  const completedLines = linesBefore.slice(0, -1);

  const stack: Scope[] = [
    { indent: 0, path: [], siblings: {}, lastEmptyKey: null },
  ];

  for (const rawLine of completedLines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const indent = leadingSpaces(rawLine);
    const trimmed = rawLine.slice(indent);

    while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
      stack.pop();
    }
    let scope = stack[stack.length - 1];

    if (trimmed.startsWith("- ")) {
      const arrayKey = scope.lastEmptyKey;
      const itemPath = arrayKey ? [...scope.path, arrayKey, "[]"] : [...scope.path, "[]"];
      const itemBody = trimmed.slice(2);
      const kvMatch = itemBody.match(KEY_VALUE_RE);

      if (kvMatch) {
        const key = kvMatch[1];
        const rawValue = stripInlineComment(kvMatch[2]).trim();
        const itemScope: Scope = {
          indent: indent + 2,
          path: itemPath,
          siblings: { [key]: rawValue },
          lastEmptyKey: isBlockOpener(rawValue) ? key : null,
        };
        stack.push(itemScope);
      }
      // Bare scalar item: no scope change.
      continue;
    }

    const kvMatch = trimmed.match(KEY_VALUE_RE);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const rawValue = stripInlineComment(kvMatch[2]).trim();

    if (indent > scope.indent && scope.lastEmptyKey) {
      // Descending into a nested mapping under the previous empty-value key.
      const childScope: Scope = {
        indent,
        path: [...scope.path, scope.lastEmptyKey],
        siblings: { [key]: rawValue },
        lastEmptyKey: isBlockOpener(rawValue) ? key : null,
      };
      scope.lastEmptyKey = null;
      stack.push(childScope);
      scope = childScope;
    } else if (indent === scope.indent) {
      scope.siblings[key] = rawValue;
      scope.lastEmptyKey = isBlockOpener(rawValue) ? key : null;
    } else if (indent > scope.indent) {
      // Orphan descent (lastEmptyKey already consumed by an earlier branch).
      const childScope: Scope = {
        indent,
        path: [...scope.path],
        siblings: { [key]: rawValue },
        lastEmptyKey: isBlockOpener(rawValue) ? key : null,
      };
      stack.push(childScope);
    }
    // indent < scope.indent should be impossible after pops above.
  }

  const currentIndent = leadingSpaces(currentLine);
  const currentTrimmed = currentLine.slice(currentIndent);

  while (stack.length > 1 && stack[stack.length - 1].indent > currentIndent) {
    stack.pop();
  }
  const scope = stack[stack.length - 1];

  let path: string[] = [];
  let currentKey: string | null = null;
  let valuePrefix = "";
  let isArrayItemValue = false;
  let scopeSiblings: Record<string, string> = {};
  let parentSiblings: Record<string, string> = {};

  if (currentTrimmed.startsWith("-")) {
    const afterDash = currentTrimmed.replace(/^-\s*/, "");
    const arrayKey = scope.lastEmptyKey;
    path = arrayKey ? [...scope.path, arrayKey, "[]"] : [...scope.path, "[]"];
    parentSiblings = scope.siblings;

    const kvMatch = afterDash.match(KEY_VALUE_RE);
    if (kvMatch) {
      currentKey = kvMatch[1];
      valuePrefix = stripInlineComment(kvMatch[2]).trim();
      path.push(currentKey);
      scopeSiblings = { [currentKey]: valuePrefix };
    } else {
      valuePrefix = stripInlineComment(afterDash).trim();
      isArrayItemValue = true;
      scopeSiblings = {};
    }
  } else {
    const kvMatch = currentTrimmed.match(KEY_VALUE_RE);
    if (!kvMatch) return null;

    currentKey = kvMatch[1];
    valuePrefix = stripInlineComment(kvMatch[2]).trim();

    if (currentIndent > scope.indent && scope.lastEmptyKey) {
      // Descending; the key belongs to a new mapping under lastEmptyKey.
      path = [...scope.path, scope.lastEmptyKey, currentKey];
      parentSiblings = scope.siblings;
      scopeSiblings = { [currentKey]: valuePrefix };
    } else {
      // Sibling in the current scope.
      path = [...scope.path, currentKey];
      scopeSiblings = { ...scope.siblings, [currentKey]: valuePrefix };
      const parentScope = stack.length >= 2 ? stack[stack.length - 2] : null;
      parentSiblings = parentScope ? parentScope.siblings : {};
    }
  }

  return {
    path,
    currentKey,
    valuePrefix,
    isArrayItemValue,
    scopeSiblings,
    parentSiblings,
  };
}

function leadingSpaces(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

function isBlockOpener(rawValue: string): boolean {
  return rawValue === "" || rawValue === "|" || rawValue === ">" || rawValue === "|-" || rawValue === ">-";
}

function stripInlineComment(s: string): string {
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "#" && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Suggestions for the given context, filtered by what the user has typed so far.
 */
export function suggestionsFor(
  ctx: YamlContext,
  catalog: Catalog,
  parsedManifest: Record<string, unknown> | null,
): Suggestion[] {
  const all = rawSuggestions(ctx, catalog, parsedManifest);
  const prefix = unquote(ctx.valuePrefix).toLowerCase();
  if (!prefix) return all;
  return all.filter((s) => s.value.toLowerCase().includes(prefix));
}

function rawSuggestions(
  ctx: YamlContext,
  catalog: Catalog,
  parsedManifest: Record<string, unknown> | null,
): Suggestion[] {
  const pathStr = ctx.path.join(".");
  const { currentKey, scopeSiblings, parentSiblings, isArrayItemValue } = ctx;

  if (pathStr === "kind") {
    return AGENT_KINDS.map((k) => ({ value: k }));
  }

  if (pathStr === "model.provider") {
    return catalog.providers.map((p) => ({
      value: p.id,
      hint: p.configured ? p.name : `${p.name} (not configured)`,
    }));
  }

  if (pathStr === "model.name") {
    const providerId = readManifestPath(parsedManifest, ["model", "provider"]);
    const provider = providerId ? catalog.providers.find((p) => p.id === providerId) : null;
    if (provider && provider.models.length > 0) {
      return provider.models.map((m) => ({ value: m, hint: provider.name }));
    }
    return catalog.providers.flatMap((p) =>
      p.models.map((m) => ({ value: m, hint: p.name })),
    );
  }

  if (pathStr === "tools.[].kind") {
    return TOOL_ENTRY_KINDS.map((k) => ({ value: k }));
  }
  if (pathStr === "tools.[].server") {
    return catalog.mcpServers.map((s) => ({
      value: s.id,
      hint: s.displayName,
    }));
  }
  if (pathStr === "tools.[].agent") {
    return catalog.agents.map((a) => ({ value: a.id, hint: a.name }));
  }
  if (pathStr === "tools.[].tools.[]" && isArrayItemValue) {
    const kind = parentSiblings.kind ?? scopeSiblings.kind;
    if (kind === "local") {
      return catalog.tools
        .filter((t) => t.source === "inline")
        .map((t) => ({ value: t.name, hint: t.description }));
    }
    if (kind === "mcp") {
      const serverId = parentSiblings.server ?? scopeSiblings.server;
      if (serverId) {
        const tools = catalog.mcpToolsByServer[serverId];
        if (tools && tools.length > 0) return tools.map((t) => ({ value: t }));
      }
    }
  }

  if (pathStr === "spawnable.[].kind") {
    return SPAWNABLE_KINDS.map((k) => ({ value: k }));
  }
  if (pathStr === "spawnable.[].agentId") {
    return catalog.agents.map((a) => ({ value: a.id, hint: a.name }));
  }

  if (
    currentKey === "type" &&
    (ctx.path.includes("outputSchema") || ctx.path.includes("inputSchema"))
  ) {
    return PROPERTY_TYPES.map((t) => ({ value: t }));
  }

  return [];
}

function readManifestPath(
  manifest: Record<string, unknown> | null,
  segments: string[],
): string | null {
  let current: unknown = manifest;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

/**
 * The MCP server id (if any) in scope for the caret. The editor uses this to
 * preload tools for that server before showing suggestions.
 */
export function mcpServerInScope(ctx: YamlContext): string | null {
  if (ctx.parentSiblings.kind === "mcp" && typeof ctx.parentSiblings.server === "string") {
    return ctx.parentSiblings.server;
  }
  if (ctx.scopeSiblings.kind === "mcp" && typeof ctx.scopeSiblings.server === "string") {
    return ctx.scopeSiblings.server;
  }
  return null;
}
