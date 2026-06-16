import type { HTTPAuth } from "./http-auth.js";

/**
 * HTTP tool entry — one endpoint exposed to the model as one tool.
 * URL placeholders ({X}, {X?}) derive the LLM-facing schema. Any keys in
 * `params:` pin those placeholders to state-resolved templates (mirrors the
 * MCP WrappedToolRef convention). `headers:`, `body:`, and `params:` values
 * are all state-templated.
 *
 * Static credentials are referenced via templated headers + `{{secrets.X}}`.
 * Dynamic credentials (OAuth2, custom token exchange) are handled via the
 * `auth` block, which the runner resolves before each request (with cache +
 * refresh-on-401).
 */
export interface HTTPToolEntry {
	kind: "http";
	/** Becomes `http__<name>` for the model. Must be a programming identifier. */
	name: string;
	/** Endpoint URL. May contain `{X}` (required) or `{X?}` (optional) placeholders. */
	url: string;
	/** HTTP method. Default `GET`. */
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	description?: string;
	/** Pinned placeholders (state templates). Mirrors `WrappedToolRef.params`. */
	params?: Record<string, string>;
	/** HTTP headers. Values are state-templated and may reference `{{secrets.X}}`. */
	headers?: Record<string, string>;
	/**
	 * How to encode `body` on the wire. Only meaningful for methods that
	 * accept a body. Defaults to `json` when `body` is present.
	 */
	body_type?: "json" | "form" | "query";
	/**
	 * Request body. Templated values are interpolated from state at execute
	 * time (same semantics as `headers`/`params`). For `body_type: json` the
	 * shape is preserved; for `form`/`query` it must be a flat string map.
	 */
	body?: unknown;
	/**
	 * Dynamic authentication. When set, the runner fetches/caches a token
	 * before each request and applies it to the outgoing call. Static
	 * credentials (Bearer/Basic/API key) can continue using `headers` with
	 * `{{secrets.<name>}}` — `auth` is only needed for token-exchange flows.
	 */
	auth?: HTTPAuth;
}

/** Agent run state: the templated bag of values referenced by HTTP tools. */
export type AgentState = Record<string, unknown>;
