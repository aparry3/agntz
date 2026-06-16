// ─── HTTP tool authentication ─────────────────────────────────────────
// Declarative auth config for HTTP tools. This is shared vocabulary: manifest
// parses it from YAML and core's token-resolver resolves it at runtime, so the
// type lives in the kernel rather than being mirrored in both packages.

/**
 * Dynamic auth for HTTP tools. Discriminated by `type`.
 *
 *  - `oauth2_client_credentials`: RFC 6749 §4.4 preset for the standard
 *    client-credentials grant. Sends `grant_type=client_credentials` to a
 *    token endpoint and uses the returned `access_token`.
 *  - `token_exchange`: fully parametric. Configure the token request shape,
 *    response parsing, and how the token applies to the real request.
 */
export type HTTPAuth = OAuth2ClientCredentialsAuth | TokenExchangeAuth;

/**
 * Standard OAuth2 client-credentials grant (RFC 6749 §4.4). A preset over
 * `token_exchange` with the spec-defined request/response shape baked in.
 */
export interface OAuth2ClientCredentialsAuth {
	type: "oauth2_client_credentials";
	/** Token endpoint URL. */
	token_url: string;
	/** OAuth2 client id. Templated; typically `"{{secrets.X}}"`. */
	client_id: string;
	/** OAuth2 client secret. Templated; typically `"{{secrets.X}}"`. */
	client_secret: string;
	/** Optional space-delimited scope list. */
	scope?: string;
	/**
	 * Where to put client credentials in the token request. `basic_header`
	 * (RFC default) sends them in `Authorization: Basic base64(id:secret)`;
	 * `body` sends them as form fields alongside `grant_type`. Default:
	 * `basic_header`.
	 */
	creds_location?: "basic_header" | "body";
	/**
	 * Cache TTL override in seconds. Falls back to the token endpoint's
	 * `expires_in` if provided, otherwise 3000 (50 minutes).
	 */
	cache_ttl?: number;
	/**
	 * HTTP status codes that trigger a token invalidate + retry. Default
	 * `[401]`. Retry budget is hard-capped at 1 per call.
	 */
	refresh_on?: number[];
}

/**
 * Fully parametric token-exchange auth. Covers OAuth2 variants and
 * homegrown login endpoints that don't match the spec.
 */
export interface TokenExchangeAuth {
	type: "token_exchange";
	/** How to fetch the token. */
	request: TokenExchangeRequest;
	/** How to extract the token from the response. */
	extract: TokenExchangeExtract;
	/**
	 * How to apply the token to the real request. Optional — when omitted the
	 * resolver defaults to `Authorization: Bearer {token}` (a header).
	 */
	apply?: TokenExchangeApply;
	/**
	 * Cache TTL override in seconds. Falls back to `extract.expires_path`
	 * if set, otherwise 3000 (50 minutes).
	 */
	cache_ttl?: number;
	/**
	 * HTTP status codes that trigger a token invalidate + retry. Default
	 * `[401]`. Retry budget is hard-capped at 1 per call.
	 */
	refresh_on?: number[];
}

export interface TokenExchangeRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	/** Headers to send on the token request. State-templated. */
	headers?: Record<string, string>;
	/** Body encoding. Defaults to `json` when `body` is present. */
	body_type?: "json" | "form" | "query";
	/** Body for the token request. State-templated. */
	body?: unknown;
}

export interface TokenExchangeExtract {
	/**
	 * How to parse the response. `json` (default) parses then JSONPath-extracts;
	 * `text` treats the whole body as the token string and ignores `token_path`.
	 * When omitted, parsing is inferred from the `Content-Type` header.
	 */
	response_format?: "json" | "text";
	/**
	 * JSONPath to the token inside a JSON response. Must start with `$`.
	 * Ignored when `response_format: text`. Required otherwise.
	 */
	token_path?: string;
	/**
	 * Optional JSONPath to the token TTL in seconds (e.g. OAuth2 `expires_in`).
	 * Falls back to `cache_ttl`, then the 3000s default.
	 */
	expires_path?: string;
}

export interface TokenExchangeApply {
	/** Where to put the token on the real request. Default `header`. */
	location?: "header" | "query";
	/**
	 * Header or query parameter name. Default `Authorization` for `header`;
	 * required for `query`.
	 */
	name?: string;
	/**
	 * Template applied to the token before placing it. Must contain `{token}`.
	 * Default `"Bearer {token}"` for `header`; `"{token}"` for `query`.
	 */
	format?: string;
}
