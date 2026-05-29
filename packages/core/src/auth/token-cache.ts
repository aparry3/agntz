import type { TokenCache, TokenCacheEntry } from "./types.js";

/**
 * In-memory token cache. Lost on process restart. Suitable for the
 * embedded runner and for the worker between cold starts; a persistent
 * implementation can swap in later via `createRunner({ tokenCache })`.
 */
export class MapTokenCache implements TokenCache {
	private store = new Map<string, TokenCacheEntry>();

	get(key: string): TokenCacheEntry | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
			this.store.delete(key);
			return undefined;
		}
		return entry;
	}

	set(key: string, entry: TokenCacheEntry): void {
		this.store.set(key, entry);
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	/** Test helper — wipe all entries. Not part of the TokenCache interface. */
	clear(): void {
		this.store.clear();
	}

	/**
	 * Token values currently held. Used by the trace-redaction layer to
	 * scrub any token strings that leak into spans or error bodies.
	 */
	getKnownTokens(): string[] {
		return Array.from(this.store.values()).map((e) => e.token);
	}
}
