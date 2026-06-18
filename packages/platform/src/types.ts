import type { UnifiedStore } from "@agntz/contracts";

export interface ApiKeyRecord {
	id: string;
	userId: string;
	name: string;
	keyPrefix: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
}

/**
 * API key management. `createApiKey`/`listApiKeys`/`revokeApiKey` require an
 * explicit userId (they're admin-style calls, not scoped reads).
 * `resolveApiKey` is the worker's inbound auth path — given a raw key, return
 * the tenant it belongs to.
 */
export interface ApiKeyStore {
	createApiKey(params: { userId: string; name: string }): Promise<{
		record: ApiKeyRecord;
		rawKey: string;
	}>;
	listApiKeys(userId: string): Promise<ApiKeyRecord[]>;
	revokeApiKey(params: { userId: string; keyId: string }): Promise<void>;
	resolveApiKey(
		rawKey: string,
	): Promise<{ userId: string; keyId: string } | null>;
}

/**
 * Per-tenant namespace ownership for hosted multi-tenant workers.
 */
export interface NamespaceRootStore {
	listNamespaceRoots(userId: string): Promise<string[]>;
	addNamespaceRoot(userId: string, root: string): Promise<void>;
	removeNamespaceRoot(userId: string, root: string): Promise<void>;
}

export interface WebhookDelivery {
	id: string;
	runId: string;
	callbackUrl: string;
	/** Name of the SecretStore entry whose plaintext is the HMAC signing key. */
	secretName: string;
	payload: Record<string, unknown>;
	attempts: number;
	lastAttemptAt?: string;
	status: "pending" | "delivered" | "failed_permanent";
	lastError?: string;
	createdAt: string;
}

export interface WebhookDeliveryStore {
	insert(
		delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
			payload: Record<string, unknown>;
		},
	): Promise<string>;
	updateStatus(
		id: string,
		status: WebhookDelivery["status"],
		lastError?: string,
	): Promise<void>;
	incrementAttempt(id: string, lastError?: string): Promise<void>;
	listPending(filter?: { olderThan?: string; limit?: number }): Promise<
		WebhookDelivery[]
	>;
}

export type PlatformStore = ApiKeyStore &
	NamespaceRootStore &
	WebhookDeliveryStore;

export type PlatformUnifiedStore = Omit<UnifiedStore, "forUser" | "userId"> &
	PlatformStore & {
		forUser(userId: string): PlatformUnifiedStore;
		readonly userId: string | null;
	};
