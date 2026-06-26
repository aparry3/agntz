import {
	NamespaceGrantError,
	isSameOrDescendantNamespace,
	namespaceAncestors,
	narrowNamespaceGrants,
	normalizeNamespaceGrant,
} from "@agntz/contracts";
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

export type HostedStore = ApiKeyStore &
	NamespaceRootStore &
	WebhookDeliveryStore;

export type AgntzStore = Omit<UnifiedStore, "forUser" | "userId"> &
	HostedStore & {
		forUser(userId: string): AgntzStore;
		readonly userId: string | null;
	};

export const NAMESPACE_UNBOUNDED_PERMISSION = "namespace:unbounded";

export class ForbiddenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}
}

export type AllowedRoots =
	| { unbounded: true }
	| { unbounded: false; roots: string[] };

export interface NamespacePolicyAuthContext {
	tenantId: string;
	authMethod?: string;
	permissions?: readonly string[];
}

export async function resolveAllowedRoots(
	ctx: NamespacePolicyAuthContext,
	store: NamespaceRootStore,
): Promise<AllowedRoots> {
	if (
		ctx.authMethod !== "api_key" &&
		ctx.permissions?.includes(NAMESPACE_UNBOUNDED_PERMISSION)
	) {
		return { unbounded: true };
	}
	const roots = await store.listNamespaceRoots(ctx.tenantId);
	return { unbounded: false, roots };
}

const NO_ROOTS_MESSAGE =
	"tenant has no registered namespace roots; register one before using memory/scope operations";

export function narrowToRoots(
	allowed: AllowedRoots,
	requestedGrants: string[],
): string[] {
	if (allowed.unbounded) return requestedGrants;
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	return narrowNamespaceGrants(allowed.roots, requestedGrants);
}

export function readScopes(
	allowed: AllowedRoots,
	requestedGrants: string[],
): { scopes: string[]; includeAncestors: boolean } {
	if (allowed.unbounded) {
		return { scopes: requestedGrants, includeAncestors: true };
	}
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	const narrowed = narrowNamespaceGrants(allowed.roots, requestedGrants);
	const seen = new Set<string>();
	const scopes: string[] = [];
	for (const grant of narrowed) {
		for (const ancestor of namespaceAncestors(grant)) {
			if (seen.has(ancestor)) continue;
			if (
				allowed.roots.some((root) =>
					isSameOrDescendantNamespace(ancestor, root),
				)
			) {
				seen.add(ancestor);
				scopes.push(ancestor);
			}
		}
	}
	return { scopes, includeAncestors: false };
}

export function assertScopeWithinRoots(
	allowed: AllowedRoots,
	scope: string,
): string {
	const normalized = normalizeNamespaceGrant(scope);
	if (allowed.unbounded) return normalized;
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	const withinRoot = allowed.roots.some((root) =>
		isSameOrDescendantNamespace(normalized, root),
	);
	if (!withinRoot) {
		throw new NamespaceGrantError(
			normalized,
			`scope is not within tenant roots [${allowed.roots.join(", ")}]`,
		);
	}
	return normalized;
}
