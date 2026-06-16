// ═══════════════════════════════════════════════════════════════════════
// HTTP tool auth.
//
// The declarative auth config (HTTPAuth + variants) is shared vocabulary and
// now lives in @agntz/contracts — both core (which resolves it at runtime) and
// manifest (which parses it from YAML) consume the one canonical type. It is
// re-exported here so core's public surface (via auth/index.ts) is unchanged.
// The runtime types below stay in core.
// ═══════════════════════════════════════════════════════════════════════
import type { HTTPAuth } from "@agntz/contracts";

export type {
	HTTPAuth,
	OAuth2ClientCredentialsAuth,
	TokenExchangeApply,
	TokenExchangeAuth,
	TokenExchangeExtract,
	TokenExchangeRequest,
} from "@agntz/contracts";

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
	get(
		key: string,
	): TokenCacheEntry | undefined | Promise<TokenCacheEntry | undefined>;
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
	resolve(
		auth: HTTPAuth,
		state: Record<string, unknown>,
		ctx: ResolveAuthCtx,
	): Promise<AppliedAuth>;
	invalidate(auth: HTTPAuth, ctx: ResolveAuthCtx): Promise<void>;
}

export class AuthError extends Error {
	constructor(
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "AuthError";
	}
}
