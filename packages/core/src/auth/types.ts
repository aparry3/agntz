// ═══════════════════════════════════════════════════════════════════════
// HTTP tool auth — runtime types (structural mirror of @agntz/manifest).
//
// Mirrored locally for the same reason as HTTPToolEntry in http-tool.ts:
// @agntz/core cannot depend on @agntz/manifest (manifest is the dependant).
// TypeScript structural typing means values from the manifest package flow
// through with zero conversion.
// ═══════════════════════════════════════════════════════════════════════

export type HTTPAuth = OAuth2ClientCredentialsAuth | TokenExchangeAuth;

export interface OAuth2ClientCredentialsAuth {
  type: "oauth2_client_credentials";
  token_url: string;
  client_id: string;
  client_secret: string;
  scope?: string;
  creds_location?: "basic_header" | "body";
  cache_ttl?: number;
  refresh_on?: number[];
}

export interface TokenExchangeAuth {
  type: "token_exchange";
  request: TokenExchangeRequest;
  extract: TokenExchangeExtract;
  apply?: TokenExchangeApply;
  cache_ttl?: number;
  refresh_on?: number[];
}

export interface TokenExchangeRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body_type?: "json" | "form" | "query";
  body?: unknown;
}

export interface TokenExchangeExtract {
  response_format?: "json" | "text";
  token_path?: string;
  expires_path?: string;
}

export interface TokenExchangeApply {
  location?: "header" | "query";
  name?: string;
  format?: string;
}

// ─── Runtime types ───────────────────────────────────────────────────

/**
 * What the resolver produces. The HTTP tool merges these into the
 * outgoing request before fetch().
 */
export interface AppliedAuth {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface TokenCacheEntry {
  token: string;
  /** epoch ms; undefined → never expires (rare). */
  expiresAt?: number;
}

/**
 * Pluggable token cache. The default `MapTokenCache` is in-memory and
 * scoped to a runner instance. Hosted multi-process deployments can swap
 * in a persistent backend (Redis, Postgres) without changing call sites.
 */
export interface TokenCache {
  get(key: string): TokenCacheEntry | undefined | Promise<TokenCacheEntry | undefined>;
  set(key: string, entry: TokenCacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export interface ResolveAuthCtx {
  /**
   * Tenant / credential boundary. Tokens are scoped to this id so two
   * users with the same OAuth app don't share a token. In single-tenant
   * embedded mode this is typically undefined and all calls share one
   * cache namespace.
   */
  ownerId?: string;
}

export interface TokenResolver {
  resolve(auth: HTTPAuth, state: Record<string, unknown>, ctx: ResolveAuthCtx): Promise<AppliedAuth>;
  invalidate(auth: HTTPAuth, ctx: ResolveAuthCtx): Promise<void>;
}

export class AuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AuthError";
  }
}
