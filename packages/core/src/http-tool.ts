// ═══════════════════════════════════════════════════════════════════════
// HTTP tool runtime — builds a `ToolDefinition` from an HTTP tool entry
// plus a pre-resolved state object (containing secrets and any other
// state values referenced by `params`/`headers` templates).
//
// The runtime is intentionally decoupled from `@agntz/manifest`: the small
// URL parser and template interpolator are inlined here to avoid a
// workspace circular dependency (manifest already has a peer dep on core).
// The semantics MUST stay in lockstep with manifest's `http-url.ts` and
// `template.ts`; both are tiny and locked by spec, so drift is unlikely.
//
// The `HTTPToolEntry` and `AgentState` shapes are mirrored here as local
// structural types — TypeScript structural typing means callers passing a
// `@agntz/manifest` `HTTPToolEntry` interoperate seamlessly without core
// taking a runtime dep on manifest.
// ═══════════════════════════════════════════════════════════════════════
import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { interpolate, interpolateDeep } from "./auth/template.js";

/**
 * Structural mirror of `HTTPToolEntry` from `@agntz/manifest`. Kept in
 * lockstep — see top-of-file comment.
 */
export interface HTTPToolEntry {
  kind: "http";
  name: string;
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  description?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body_type?: "json" | "form" | "query";
  body?: unknown;
  /** Dynamic auth — opaque here; the runner resolves and applies it. */
  auth?: unknown;
}

/** Structural mirror of `AgentState` from `@agntz/manifest`. */
export type AgentState = Record<string, unknown>;

/** Rough 4-chars-per-token estimate for response truncation. */
const MAX_TOKENS = 10_000;
const MAX_CHARS = MAX_TOKENS * 4; // 40_000

// ─── URL placeholders ─────────────────────────────────────────────────
// `{name}` is required; `{name?}` is optional (legal only in query string —
// validator rejects optional in path). Position is determined by whether the
// placeholder appears before or after the first `?`.
const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\}/g;

type Placeholder = {
  name: string;
  optional: boolean;
  position: "path" | "query";
};

function parseUrlPlaceholders(url: string): Placeholder[] {
  const queryStart = url.indexOf("?");
  const splitAt = queryStart === -1 ? url.length : queryStart;
  const result: Placeholder[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(url)) !== null) {
    result.push({
      name: match[1],
      optional: match[2] === "?",
      position: match.index < splitAt ? "path" : "query",
    });
  }
  return result;
}

function buildHttpUrl(
  urlTemplate: string,
  values: Record<string, string | undefined>,
): string {
  const queryStart = urlTemplate.indexOf("?");
  const pathTemplate = queryStart === -1 ? urlTemplate : urlTemplate.slice(0, queryStart);
  const queryTemplate = queryStart === -1 ? "" : urlTemplate.slice(queryStart + 1);

  const path = pathTemplate.replace(PLACEHOLDER_RE, (_full, rawName: string, opt: string | undefined) => {
    const value = values[rawName];
    if (value == null) {
      if (opt === "?") return "";
      throw new Error(`Missing required placeholder '${rawName}' for URL`);
    }
    return encodeURIComponent(value);
  });

  if (queryStart === -1) return path;

  const params = new URLSearchParams();
  if (queryTemplate.length > 0) {
    for (const pair of queryTemplate.split("&")) {
      if (pair.length === 0) continue;
      const eqIdx = pair.indexOf("=");
      const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
      const rawVal = eqIdx === -1 ? "" : pair.slice(eqIdx + 1);

      PLACEHOLDER_RE.lastIndex = 0;
      const valMatch = PLACEHOLDER_RE.exec(rawVal);
      const placeholdersInVal: Placeholder[] = [];
      PLACEHOLDER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PLACEHOLDER_RE.exec(rawVal)) !== null) {
        placeholdersInVal.push({ name: m[1], optional: m[2] === "?", position: "query" });
      }

      if (placeholdersInVal.length === 0) {
        params.append(rawKey, rawVal);
        continue;
      }

      // Exact-shape "key={name?}" + missing value → drop the pair entirely.
      if (
        placeholdersInVal.length === 1 &&
        valMatch != null &&
        valMatch[0] === rawVal &&
        valMatch[2] === "?"
      ) {
        const v = values[valMatch[1]];
        if (v == null) continue;
        params.append(rawKey, v);
        continue;
      }

      const substituted = rawVal.replace(
        PLACEHOLDER_RE,
        (_full, rawName: string, opt: string | undefined) => {
          const v = values[rawName];
          if (v == null) {
            if (opt === "?") return "";
            throw new Error(`Missing required placeholder '${rawName}' for URL`);
          }
          return v;
        },
      );
      params.append(rawKey, substituted);
    }
  }

  const queryStr = params.toString();
  return queryStr.length === 0 ? path : `${path}?${queryStr}`;
}

// ─── Truncation helpers ───────────────────────────────────────────────
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n…[truncated]";
}

/**
 * Stringify a value with 2-space indent. If the serialized form exceeds
 * `maxChars`, return the truncated string form (the model can still read it).
 * Otherwise return the value as-is so the caller's JSON encoding is
 * lossless.
 */
function truncateValue(val: unknown, maxChars: number): unknown {
  const serialized = JSON.stringify(val, null, 2);
  if (serialized == null) return val;
  if (serialized.length <= maxChars) return val;
  return truncate(serialized, maxChars);
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Build a `ToolDefinition` for an HTTP tool entry. Pinned `params:` are
 * interpolated from `state` at execute time (so the LLM never sees them in
 * its tool schema); the remaining URL placeholders become the tool's input
 * schema. `headers:` values are interpolated from state on every call (this
 * is where `{{secrets.X}}` references are resolved — state must already
 * carry the decrypted values under `state.secrets`).
 *
 * Tool name is namespaced as `http__<entry.name>` (parallel to MCP's
 * `mcp__<server>__<tool>` convention).
 *
 * Response shaping:
 *  - 4xx/5xx → `{ error: "HTTP <status>", body: <truncated text> }`
 *  - JSON content-type → parsed JSON, truncated if huge
 *  - everything else → text, truncated
 *  - Timeout (30s) → `{ error: "Request timeout after 30s" }`
 *  - Other network error → `{ error: "Network error: <message>" }`
 */
export function buildHttpToolDefinition(
  entry: HTTPToolEntry,
  state: AgentState,
): ToolDefinition {
  const placeholders = parseUrlPlaceholders(entry.url);
  const pinned = new Set(Object.keys(entry.params ?? {}));

  // The LLM-facing input schema: every placeholder NOT pinned via `params:`
  // becomes a required (or optional, if `{X?}`) string property.
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of placeholders) {
    if (pinned.has(p.name)) continue;
    shape[p.name] = p.optional ? z.string().optional() : z.string();
  }
  const input = z.object(shape);

  const toolName = `http__${entry.name}`;
  const description = entry.description ?? "";
  const method = entry.method ?? "GET";
  const headerTemplates = entry.headers ?? {};
  const paramTemplates = entry.params ?? {};
  const bodyType = entry.body_type ?? (entry.body !== undefined ? "json" : undefined);

  return {
    name: toolName,
    description,
    input,
    async execute(args: unknown): Promise<unknown> {
      // 1. Merge LLM args with pinned params (pinned wins — same convention as
      //    MCP `WrappedToolRef.params`).
      const values: Record<string, string | undefined> = {
        ...(args as Record<string, string | undefined>),
      };
      for (const [key, template] of Object.entries(paramTemplates)) {
        values[key] = interpolate(template, state);
      }

      // 2. Build URL and headers from templates.
      let url = buildHttpUrl(entry.url, values);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(headerTemplates)) {
        headers[k] = interpolate(v, state);
      }

      // 3. Build request body (POST/PUT/PATCH only).
      let body: string | undefined;
      if (entry.body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH")) {
        const built = buildRequestBody(entry.body, bodyType, state);
        if (built.kind === "body") {
          body = built.value;
          if (!hasHeader(headers, "content-type")) {
            headers["Content-Type"] = built.contentType;
          }
        } else if (built.kind === "query") {
          url = appendQuery(url, built.value);
        }
      }

      // 4. Issue the request with a 30s timeout.
      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(30_000),
        });

        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text();

        if (response.status >= 400) {
          return {
            error: `HTTP ${response.status}`,
            body: truncate(text, MAX_CHARS),
          };
        }

        if (contentType.includes("application/json")) {
          try {
            const parsed = JSON.parse(text);
            return truncateValue(parsed, MAX_CHARS);
          } catch {
            // Server lied about content-type — fall through to text.
          }
        }
        return truncate(text, MAX_CHARS);
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          return { error: "Request timeout after 30s" };
        }
        return {
          error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ─── Request body helpers ─────────────────────────────────────────────

type BuiltBody =
  | { kind: "body"; value: string; contentType: string }
  | { kind: "query"; value: Record<string, string> }
  | { kind: "none" };

function buildRequestBody(
  body: unknown,
  bodyType: "json" | "form" | "query" | undefined,
  state: AgentState,
): BuiltBody {
  const type = bodyType ?? "json";
  if (type === "json") {
    const interpolated = interpolateDeep(body, state);
    return {
      kind: "body",
      value: JSON.stringify(interpolated),
      contentType: "application/json",
    };
  }
  // form / query: flat string map only (validator guarantees this).
  const flat: Record<string, string> = {};
  if (body != null && typeof body === "object" && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === "string") flat[k] = interpolate(v, state);
    }
  }
  if (type === "form") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(flat)) params.append(k, v);
    return {
      kind: "body",
      value: params.toString(),
      contentType: "application/x-www-form-urlencoded",
    };
  }
  return { kind: "query", value: flat };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((h) => h.toLowerCase() === lower);
}

function appendQuery(url: string, extra: Record<string, string>): string {
  const entries = Object.entries(extra);
  if (entries.length === 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, v);
  return `${url}${sep}${params.toString()}`;
}
