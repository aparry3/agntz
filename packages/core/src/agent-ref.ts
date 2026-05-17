// ═══════════════════════════════════════════════════════════════════════
// Agent reference parser — `<id>[@<version|alias|latest>]`
// ═══════════════════════════════════════════════════════════════════════
//
// Reference forms:
//   "reviewer"                              → activated version (production default)
//   "reviewer@latest"                       → newest by created_at (moving tag)
//   "reviewer@2026-05-17T15:30:00.000Z"     → exact pinned version
//   "reviewer@stable"                       → human alias, resolved via store
//
// The parser is intentionally pure (no deps) so it can be reused from
// `@agntz/manifest`, `@agntz/sdk`, and the worker without circular imports.
// ═══════════════════════════════════════════════════════════════════════

import { InvalidAgentRefError } from "./errors.js";

export interface ParsedAgentRef {
  agentId: string;
  /** `"latest"`, an ISO 8601 timestamp, an alias name, or undefined. */
  version?: string;
}

// Aliases: start with alphanumeric, then alphanumeric / `.` / `_` / `-`.
// Length capped to keep them readable as code references.
const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True iff `s` is a syntactically valid alias name (not `latest`, not ISO). */
export function isAliasName(s: string): boolean {
  if (s === "latest") return false;
  if (isIsoTimestamp(s)) return false;
  return ALIAS_RE.test(s);
}

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/**
 * Verify the input matches the ISO 8601 shape we persist (`Date.toISOString()`)
 * AND round-trips through `Date.parse` to the same string. Rejects `2026-13-99`,
 * missing `Z`, missing `T`, etc.
 */
export function isIsoTimestamp(s: string): boolean {
  if (!ISO_TIMESTAMP_RE.test(s)) return false;
  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString() === normalizeIsoForCompare(s);
}

// `toISOString()` always emits 3-digit millis. To accept both `...:00Z` and
// `...:00.000Z` as valid inputs, pad to millis before comparing the round-trip.
function normalizeIsoForCompare(s: string): string {
  const dotIdx = s.indexOf(".");
  if (dotIdx === -1) return s.replace(/Z$/, ".000Z");
  const fraction = s.slice(dotIdx + 1, -1);
  const padded = (fraction + "000").slice(0, 3);
  return `${s.slice(0, dotIdx)}.${padded}Z`;
}

/**
 * Parse `<id>[@<version|latest>]` into structured form.
 * Throws `InvalidAgentRefError` on malformed input.
 */
export function parseAgentRef(input: string): ParsedAgentRef {
  if (typeof input !== "string") {
    throw new InvalidAgentRefError(String(input), "must be a string");
  }
  if (input.length === 0) {
    throw new InvalidAgentRefError(input, "agent id is empty");
  }
  if (input !== input.trim() || /\s/.test(input)) {
    throw new InvalidAgentRefError(input, "must not contain whitespace");
  }

  const atIdx = input.indexOf("@");
  if (atIdx === -1) {
    return { agentId: input };
  }

  const agentId = input.slice(0, atIdx);
  const version = input.slice(atIdx + 1);

  if (agentId.length === 0) {
    throw new InvalidAgentRefError(input, "agent id is empty");
  }
  if (version.length === 0) {
    throw new InvalidAgentRefError(input, "version is empty after '@'");
  }
  if (version.includes("@")) {
    throw new InvalidAgentRefError(input, "more than one '@' is not allowed");
  }
  if (version !== "latest" && !isIsoTimestamp(version) && !isAliasName(version)) {
    throw new InvalidAgentRefError(
      input,
      `version must be "latest", an ISO 8601 timestamp, or an alias (got "${version}")`,
    );
  }

  return { agentId, version };
}

/**
 * Inverse of `parseAgentRef`. Stable string form used for UI copy buttons,
 * span attributes, and any wire serialization.
 */
export function formatAgentRef(ref: ParsedAgentRef): string {
  return ref.version ? `${ref.agentId}@${ref.version}` : ref.agentId;
}
