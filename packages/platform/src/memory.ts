import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeNamespaceGrant } from "@agntz/contracts";
import {
	type MemoryBackend,
	MemoryStore,
	createMemoryBackend,
} from "@agntz/core";
import type {
	ApiKeyRecord,
	PlatformUnifiedStore,
	WebhookDelivery,
} from "./types.js";

interface ApiKeyRow {
	id: string;
	userId: string;
	name: string;
	keyPrefix: string;
	keyHash: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
}

export interface PlatformMemoryBackend {
	apiKeys: Map<string, ApiKeyRow>;
	apiKeyByHash: Map<string, ApiKeyRow>;
	namespaceRoots: Map<string, Set<string>>;
	webhookDeliveries: Map<string, WebhookDelivery>;
}

function createPlatformMemoryBackend(): PlatformMemoryBackend {
	return {
		apiKeys: new Map(),
		apiKeyByHash: new Map(),
		namespaceRoots: new Map(),
		webhookDeliveries: new Map(),
	};
}

export class PlatformMemoryStore
	extends MemoryStore
	implements PlatformUnifiedStore
{
	private platformBackend: PlatformMemoryBackend;

	constructor(
		opts: {
			userId?: string;
			backend?: MemoryBackend;
			platformBackend?: PlatformMemoryBackend;
			strict?: boolean;
		} = {},
	) {
		super({
			...opts,
			backend: opts.backend ?? createMemoryBackend(),
		});
		this.platformBackend =
			opts.platformBackend ?? createPlatformMemoryBackend();
	}

	override forUser(userId: string): PlatformMemoryStore {
		return new PlatformMemoryStore({
			userId,
			backend: this.backend,
			platformBackend: this.platformBackend,
		});
	}

	private requirePlatformUser(): string {
		if (!this.userId) {
			throw new Error(
				"PlatformMemoryStore: user not set. Call forUser(id) first.",
			);
		}
		return this.userId;
	}

	async createApiKey(params: { userId: string; name: string }): Promise<{
		record: ApiKeyRecord;
		rawKey: string;
	}> {
		const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
		const keyPrefix = rawKey.slice(0, 14);
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const row: ApiKeyRow = {
			id: randomUUID(),
			userId: params.userId,
			name: params.name,
			keyPrefix,
			keyHash,
			createdAt: new Date().toISOString(),
			lastUsedAt: null,
			revokedAt: null,
		};
		this.platformBackend.apiKeys.set(row.id, row);
		this.platformBackend.apiKeyByHash.set(keyHash, row);
		return { record: rowToRecord(row), rawKey };
	}

	async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
		return Array.from(this.platformBackend.apiKeys.values())
			.filter((r) => r.userId === userId)
			.map(rowToRecord)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
		const row = this.platformBackend.apiKeys.get(params.keyId);
		if (!row || row.userId !== params.userId) return;
		row.revokedAt = new Date().toISOString();
	}

	async resolveApiKey(
		rawKey: string,
	): Promise<{ userId: string; keyId: string } | null> {
		const keyHash = createHash("sha256").update(rawKey).digest("hex");
		const row = this.platformBackend.apiKeyByHash.get(keyHash);
		if (!row || row.revokedAt) return null;
		row.lastUsedAt = new Date().toISOString();
		return { userId: row.userId, keyId: row.id };
	}

	async listNamespaceRoots(userId: string): Promise<string[]> {
		return Array.from(
			this.platformBackend.namespaceRoots.get(userId) ?? [],
		).sort();
	}

	async addNamespaceRoot(userId: string, root: string): Promise<void> {
		const normalized = normalizeNamespaceGrant(root);
		let roots = this.platformBackend.namespaceRoots.get(userId);
		if (!roots) {
			roots = new Set();
			this.platformBackend.namespaceRoots.set(userId, roots);
		}
		roots.add(normalized);
	}

	async removeNamespaceRoot(userId: string, root: string): Promise<void> {
		const normalized = normalizeNamespaceGrant(root);
		this.platformBackend.namespaceRoots.get(userId)?.delete(normalized);
	}

	async insert(
		delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
			payload: Record<string, unknown>;
		},
	): Promise<string> {
		this.requirePlatformUser();
		const now = new Date().toISOString();
		const row: WebhookDelivery = {
			id: delivery.id,
			runId: delivery.runId,
			callbackUrl: delivery.callbackUrl,
			secretName: delivery.secretName,
			payload: delivery.payload,
			attempts: 0,
			status: "pending",
			createdAt: now,
		};
		this.platformBackend.webhookDeliveries.set(delivery.id, row);
		return delivery.id;
	}

	async updateStatus(
		id: string,
		status: WebhookDelivery["status"],
		lastError?: string,
	): Promise<void> {
		const row = this.platformBackend.webhookDeliveries.get(id);
		if (!row) return;
		row.status = status;
		if (lastError !== undefined) row.lastError = lastError;
	}

	async incrementAttempt(id: string, lastError?: string): Promise<void> {
		const row = this.platformBackend.webhookDeliveries.get(id);
		if (!row) return;
		row.attempts += 1;
		row.lastAttemptAt = new Date().toISOString();
		if (lastError !== undefined) row.lastError = lastError;
	}

	async listPending(filter?: { olderThan?: string; limit?: number }): Promise<
		WebhookDelivery[]
	> {
		this.requirePlatformUser();
		const rows: WebhookDelivery[] = [];
		for (const r of this.platformBackend.webhookDeliveries.values()) {
			if (r.status !== "pending") continue;
			if (filter?.olderThan && r.createdAt >= filter.olderThan) continue;
			rows.push({ ...r });
		}
		rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		return filter?.limit ? rows.slice(0, filter.limit) : rows;
	}
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		keyPrefix: row.keyPrefix,
		createdAt: row.createdAt,
		lastUsedAt: row.lastUsedAt,
		revokedAt: row.revokedAt,
	};
}
