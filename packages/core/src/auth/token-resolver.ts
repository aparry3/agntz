import {
	OutboundUrlPolicyError,
	type OutboundUrlPolicyOptions,
	fetchWithOutboundPolicy,
} from "../utils/outbound-url.js";
import { collectSensitiveValues, scrubString } from "./redact.js";
// ═══════════════════════════════════════════════════════════════════════
// Token resolution for HTTP tool auth.
//
// Given an HTTPAuth config + state (carrying decrypted secrets/env), the
// resolver:
//   1. Computes a deterministic cache key from (auth shape, ownerId).
//   2. Returns cached token if present and unexpired.
//   3. Otherwise issues the token request (single-flight: concurrent
//      calls with the same key wait on one in-flight fetch).
//   4. Extracts the token (and optional TTL) per `extract` config.
//   5. Returns an AppliedAuth describing how to attach it to the next
//      outgoing request (header or query).
//
// On 401 from the real request, the caller calls invalidate() and
// re-resolves; the HTTP tool retries exactly once.
// ═══════════════════════════════════════════════════════════════════════
import { interpolate, interpolateDeep } from "./template.js";
import {
	type AppliedAuth,
	AuthError,
	type HTTPAuth,
	type OAuth2ClientCredentialsAuth,
	type ResolveAuthCtx,
	type TokenCache,
	type TokenCacheEntry,
	type TokenExchangeApply,
	type TokenExchangeAuth,
	type TokenExchangeRequest,
	type TokenResolver,
} from "./types.js";

/** 50 minutes — slightly under the most common 1-hour token lifetime. */
const DEFAULT_TTL_SECONDS = 3000;

export interface TokenResolverDeps {
	cache: TokenCache;
	/** Override for tests. Defaults to global fetch. */
	fetchImpl?: typeof fetch;
	/** Override outbound URL policy. Custom test fetches skip DNS by default. */
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
	/** Override for tests. Defaults to Date.now. */
	now?: () => number;
}

export function createTokenResolver(deps: TokenResolverDeps): TokenResolver {
	const cache = deps.cache;
	const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
	const outboundUrlPolicy =
		deps.outboundUrlPolicy ??
		(deps.fetchImpl ? { skipDnsResolution: true } : undefined);
	const now = deps.now ?? Date.now;
	const inflight = new Map<string, Promise<TokenCacheEntry>>();

	return {
		async resolve(auth, state, ctx) {
			const normalized = normalizeAuth(auth);
			const key = cacheKey(normalized, ctx);

			const cached = await cache.get(key);
			if (cached) return applyToken(cached.token, normalized);

			const pending = inflight.get(key);
			if (pending) {
				const entry = await pending;
				return applyToken(entry.token, normalized);
			}

			const fetchPromise = (async (): Promise<TokenCacheEntry> => {
				try {
					const entry = await fetchToken(
						normalized,
						state,
						fetchImpl,
						now,
						outboundUrlPolicy,
					);
					await cache.set(key, entry);
					return entry;
				} finally {
					inflight.delete(key);
				}
			})();
			inflight.set(key, fetchPromise);

			const entry = await fetchPromise;
			return applyToken(entry.token, normalized);
		},

		async invalidate(auth, ctx) {
			const normalized = normalizeAuth(auth);
			await cache.delete(cacheKey(normalized, ctx));
		},
	};
}

// ─── Normalization ────────────────────────────────────────────────────
// Both auth types collapse to a single internal shape so the rest of
// the resolver only handles token_exchange.

interface NormalizedAuth {
	request: Required<Pick<TokenExchangeRequest, "url">> & {
		method: string;
		headers: Record<string, string>;
		body_type?: "json" | "form" | "query";
		body?: unknown;
	};
	extract: {
		response_format?: "json" | "text";
		token_path?: string;
		expires_path?: string;
	};
	apply: Required<TokenExchangeApply>;
	cache_ttl?: number;
	refresh_on: number[];
	/** Used as a stable shape hash for cache keys. */
	shape: unknown;
}

function normalizeAuth(auth: HTTPAuth): NormalizedAuth {
	if (auth.type === "token_exchange") {
		return {
			request: {
				url: auth.request.url,
				method: auth.request.method ?? "POST",
				headers: auth.request.headers ?? {},
				body_type: auth.request.body_type,
				body: auth.request.body,
			},
			extract: {
				response_format: auth.extract.response_format,
				token_path: auth.extract.token_path,
				expires_path: auth.extract.expires_path,
			},
			apply: normalizeApply(auth.apply),
			cache_ttl: auth.cache_ttl,
			refresh_on: auth.refresh_on ?? [401],
			shape: auth,
		};
	}
	return normalizeOAuth2(auth);
}

function normalizeOAuth2(a: OAuth2ClientCredentialsAuth): NormalizedAuth {
	const credsLocation = a.creds_location ?? "basic_header";
	const headers: Record<string, string> = {};
	const body: Record<string, string> = { grant_type: "client_credentials" };

	if (credsLocation === "basic_header") {
		headers.Authorization = "Basic __OAUTH2_BASIC__";
	} else {
		body.client_id = a.client_id;
		body.client_secret = a.client_secret;
	}
	if (a.scope) body.scope = a.scope;

	return {
		request: {
			url: a.token_url,
			method: "POST",
			headers,
			body_type: "form",
			body,
		},
		extract: {
			response_format: "json",
			token_path: "$.access_token",
			expires_path: "$.expires_in",
		},
		apply: normalizeApply({
			location: "header",
			name: "Authorization",
			format: "Bearer {token}",
		}),
		cache_ttl: a.cache_ttl,
		refresh_on: a.refresh_on ?? [401],
		shape: a,
	};
}

function normalizeApply(
	apply: TokenExchangeApply | undefined,
): Required<TokenExchangeApply> {
	const location = apply?.location ?? "header";
	const name = apply?.name ?? (location === "header" ? "Authorization" : "");
	const format =
		apply?.format ?? (location === "header" ? "Bearer {token}" : "{token}");
	return { location, name, format };
}

// ─── Cache key ────────────────────────────────────────────────────────

function cacheKey(auth: NormalizedAuth, ctx: ResolveAuthCtx): string {
	const owner = ctx.ownerId ?? "__shared__";
	const shape = stableStringify(auth.shape);
	return `${owner}|${hashString(shape)}`;
}

function stableStringify(node: unknown): string {
	if (node == null || typeof node !== "object") return JSON.stringify(node);
	if (Array.isArray(node)) return `[${node.map(stableStringify).join(",")}]`;
	const keys = Object.keys(node as Record<string, unknown>).sort();
	return `{${keys
		.map(
			(k) =>
				`${JSON.stringify(k)}:${stableStringify((node as Record<string, unknown>)[k])}`,
		)
		.join(",")}}`;
}

/** FNV-1a 32-bit. Sufficient — collisions are tolerable here (worst case
 *  re-fetch a token) and we don't need crypto. Avoids pulling in Node's
 *  crypto for runtime that may target the edge. */
function hashString(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash =
			(hash +
				((hash << 1) +
					(hash << 4) +
					(hash << 7) +
					(hash << 8) +
					(hash << 24))) >>>
			0;
	}
	return hash.toString(16).padStart(8, "0");
}

// ─── Token fetch ──────────────────────────────────────────────────────

async function fetchToken(
	auth: NormalizedAuth,
	state: Record<string, unknown>,
	fetchImpl: typeof fetch,
	now: () => number,
	outboundUrlPolicy: OutboundUrlPolicyOptions | undefined,
): Promise<TokenCacheEntry> {
	const url = interpolate(auth.request.url, state);
	const headers = interpolateHeaders(auth.request.headers, state);
	const bodyType =
		auth.request.body_type ??
		(auth.request.body !== undefined ? "json" : undefined);
	const built = buildBody(auth.request.body, bodyType, state);

	// OAuth2 basic-header credentials: we marked the placeholder during
	// normalization; substitute it here once we have the interpolated values.
	const basicAuthHeader = headers.Authorization;
	if (basicAuthHeader === "Basic __OAUTH2_BASIC__") {
		const cid = interpolate(
			(auth.shape as OAuth2ClientCredentialsAuth).client_id,
			state,
		);
		const csec = interpolate(
			(auth.shape as OAuth2ClientCredentialsAuth).client_secret,
			state,
		);
		headers.Authorization = `Basic ${base64(`${cid}:${csec}`)}`;
	}

	let finalUrl = url;
	let body: string | undefined;
	if (built.kind === "body") {
		body = built.value;
		if (!hasHeader(headers, "content-type")) {
			headers["Content-Type"] = built.contentType;
		}
	} else if (built.kind === "query") {
		finalUrl = appendQuery(url, built.value);
	}

	let response: Response;
	try {
		response = await fetchWithOutboundPolicy(
			finalUrl,
			{
				method: auth.request.method,
				headers,
				body,
				signal: AbortSignal.timeout(30_000),
			},
			{
				fetchImpl,
				policy: outboundUrlPolicy,
			},
		);
	} catch (err) {
		if (err instanceof OutboundUrlPolicyError) {
			throw new AuthError(
				`Token request blocked by outbound URL policy: ${err.message}`,
				err,
			);
		}
		throw new AuthError(
			`Token request failed: ${err instanceof Error ? err.message : String(err)}`,
			err,
		);
	}

	const text = await response.text();
	if (response.status >= 400) {
		const sensitive = collectSensitiveValues({
			secrets: state.secrets as Record<string, string> | undefined,
		});
		const scrubbed = scrubString(truncate(text, 500), sensitive);
		throw new AuthError(
			`Token request failed with HTTP ${response.status}: ${scrubbed}`,
		);
	}

	const isText =
		auth.extract.response_format === "text" ||
		(auth.extract.response_format == null &&
			!(response.headers.get("content-type") ?? "").includes(
				"application/json",
			) &&
			auth.extract.token_path == null);

	let token: string;
	let ttlFromResponse: number | undefined;
	if (isText) {
		token = text.trim();
	} else {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (err) {
			throw new AuthError(
				"Token response is not valid JSON (response_format defaulted to JSON). Set extract.response_format: text if the body is raw text.",
				err,
			);
		}
		if (!auth.extract.token_path) {
			throw new AuthError(
				"token_exchange.extract.token_path is required for JSON responses",
			);
		}
		const tokenVal = jsonPathGet(parsed, auth.extract.token_path);
		if (
			tokenVal == null ||
			typeof tokenVal !== "string" ||
			tokenVal.length === 0
		) {
			throw new AuthError(
				`Token not found at ${auth.extract.token_path} in token response.`,
			);
		}
		token = tokenVal;
		if (auth.extract.expires_path) {
			const ttlVal = jsonPathGet(parsed, auth.extract.expires_path);
			if (typeof ttlVal === "number" && Number.isFinite(ttlVal) && ttlVal > 0) {
				ttlFromResponse = ttlVal;
			} else if (typeof ttlVal === "string" && /^\d+$/.test(ttlVal)) {
				ttlFromResponse = Number.parseInt(ttlVal, 10);
			}
		}
	}

	const ttl = auth.cache_ttl ?? ttlFromResponse ?? DEFAULT_TTL_SECONDS;
	return { token, expiresAt: now() + ttl * 1000 };
}

// ─── Apply token to outgoing request ──────────────────────────────────

function applyToken(token: string, auth: NormalizedAuth): AppliedAuth {
	const value = auth.apply.format.replace(/\{token\}/g, token);
	if (auth.apply.location === "query") {
		return { query: { [auth.apply.name]: value } };
	}
	return { headers: { [auth.apply.name]: value } };
}

// ─── JSONPath (intentionally minimal) ─────────────────────────────────
// Supports `$.a.b[0].c` — dot-separated property access plus integer
// index brackets. No filter expressions, no recursive descent, no
// wildcards. Covers every real OAuth2 / token-exchange response shape
// I've seen; anything fancier means the user should pre-process.

function jsonPathGet(node: unknown, path: string): unknown {
	if (!path.startsWith("$")) {
		throw new AuthError(`JSONPath must start with '$': ${path}`);
	}
	const rest = path.slice(1);
	if (rest.length === 0) return node;
	const segments: Array<string | number> = [];
	const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
	let cursor = 0;
	let m = re.exec(rest);
	while (m !== null) {
		if (m.index !== cursor) {
			throw new AuthError(
				`Unsupported JSONPath syntax near '${rest.slice(cursor)}'`,
			);
		}
		segments.push(m[1] ?? Number.parseInt(m[2], 10));
		cursor = re.lastIndex;
		m = re.exec(rest);
	}
	if (cursor !== rest.length) {
		throw new AuthError(
			`Unsupported JSONPath syntax near '${rest.slice(cursor)}'`,
		);
	}
	let current: unknown = node;
	for (const seg of segments) {
		if (current == null) return undefined;
		if (typeof seg === "number") {
			if (!Array.isArray(current)) return undefined;
			current = current[seg];
		} else {
			if (typeof current !== "object") return undefined;
			current = (current as Record<string, unknown>)[seg];
		}
	}
	return current;
}

// ─── Body / header helpers (mirror http-tool.ts; kept local on purpose) ─

type BuiltBody =
	| { kind: "body"; value: string; contentType: string }
	| { kind: "query"; value: Record<string, string> }
	| { kind: "none" };

function buildBody(
	body: unknown,
	bodyType: "json" | "form" | "query" | undefined,
	state: Record<string, unknown>,
): BuiltBody {
	if (body === undefined) return { kind: "none" };
	const type = bodyType ?? "json";
	if (type === "json") {
		const interpolated = interpolateDeep(body, state);
		return {
			kind: "body",
			value: JSON.stringify(interpolated),
			contentType: "application/json",
		};
	}
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

function interpolateHeaders(
	headers: Record<string, string>,
	state: Record<string, unknown>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		out[k] = interpolate(v, state);
	}
	return out;
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

function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars
		? text
		: `${text.slice(0, maxChars)}…[truncated]`;
}

function base64(input: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(input, "utf-8").toString("base64");
	}
	// Edge runtime fallback — btoa handles latin1 only; encode UTF-8 first.
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}
