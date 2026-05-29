// ═══════════════════════════════════════════════════════════════════════
// Credential redaction for HTTP tool responses.
//
// Tokens and static secrets sometimes echo back in API error bodies
// ("invalid token: <token>"), and they flow through the LLM tool message,
// the trace span, and any logs that capture tool output. Redaction at the
// source (HTTP tool output + auth errors) means every downstream sink
// gets the scrubbed string for free — no need to know about secrets at
// the trace or log layer.
// ═══════════════════════════════════════════════════════════════════════

import type { TokenCache } from "./types.js";

/** Minimum substring length we'll scrub. Avoids redacting small junk like "a" or "1". */
const MIN_SCRUB_LEN = 6;
const REDACTED = "***REDACTED***";

/**
 * Header names that should never appear in serialized request/response
 * data. Lowercased for case-insensitive matching.
 */
export const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"x-auth-token",
	"x-amz-security-token",
]);

export interface RedactSources {
	/** Cache holding live tokens. Optional — when absent, only secrets are scrubbed. */
	tokenCache?: TokenCache;
	/** Pre-fetched secrets from state.secrets. Optional. */
	secrets?: Record<string, string>;
}

/**
 * Collect the set of substrings to scrub from outbound strings. Returned
 * fresh on each call so callers see the current set of tokens (the cache
 * may have invalidated entries between calls).
 */
export function collectSensitiveValues(sources: RedactSources): string[] {
	const values: string[] = [];
	if (sources.secrets) {
		for (const v of Object.values(sources.secrets)) {
			if (typeof v === "string" && v.length >= MIN_SCRUB_LEN) values.push(v);
		}
	}
	const cache = sources.tokenCache as unknown as
		| { getKnownTokens?: () => string[] }
		| undefined;
	if (cache && typeof cache.getKnownTokens === "function") {
		const tokens = cache.getKnownTokens();
		for (const t of tokens) {
			if (typeof t === "string" && t.length >= MIN_SCRUB_LEN) values.push(t);
		}
	}
	return values;
}

/**
 * Replace every occurrence of each sensitive value with a redaction
 * marker. Pure string substitution — does not regex-escape.
 */
export function scrubString(text: string, sensitive: string[]): string {
	let out = text;
	for (const v of sensitive) {
		if (!v || v.length < MIN_SCRUB_LEN) continue;
		if (out.includes(v)) out = out.split(v).join(REDACTED);
	}
	return out;
}

/**
 * Recursively scrub sensitive substrings from any JSON-shaped value.
 * Strings are scrubbed in place. Object keys are not modified (they're
 * structural — secrets live in values).
 */
export function scrubValue<T>(node: T, sensitive: string[]): T {
	if (typeof node === "string") return scrubString(node, sensitive) as T;
	if (Array.isArray(node))
		return node.map((n) => scrubValue(n, sensitive)) as T;
	if (node != null && typeof node === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			out[k] = scrubValue(v, sensitive);
		}
		return out as T;
	}
	return node;
}

/**
 * Redact a headers map: drops values for any header name in
 * SENSITIVE_HEADER_NAMES. Used by any code path that serializes the
 * outgoing request shape for traces or debug logs.
 */
export function redactHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		out[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? REDACTED : v;
	}
	return out;
}
