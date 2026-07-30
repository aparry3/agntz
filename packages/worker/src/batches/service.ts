import { randomUUID } from "node:crypto";
import type {
	BatchDefinition,
	BatchRequestCounts,
	BatchRun,
	BatchRunItem,
	Dataset,
	DatasetItem,
	ProviderConfig,
	UnifiedStore,
} from "@agntz/contracts";
import {
	type BatchManifest,
	type BatchProvider,
	parseBatchManifest,
} from "@agntz/core/manifest";
import type { AgntzStore } from "@agntz/stores/contracts";
import { prepareBatchRequests } from "./common.js";
import type { BatchProviderRegistry, ProviderBatchState } from "./types.js";

export interface SubmitBatchRunInput {
	batchId: string;
	batchVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	items?: DatasetItem[];
	callbackUrl?: string;
	webhookSecretName?: string;
	idempotencyKey?: string;
}

export async function submitBatchRun(options: {
	store: AgntzStore;
	userId: string;
	providers: BatchProviderRegistry;
	input: SubmitBatchRunInput;
}): Promise<BatchRun> {
	const scoped = options.store.forUser(options.userId);
	const existing = options.input.idempotencyKey
		? await scoped.getBatchRunByIdempotencyKey(options.input.idempotencyKey)
		: null;
	if (existing) return existing;

	const resolvedBatch = await resolveBatch(
		scoped,
		options.input.batchId,
		options.input.batchVersion,
	);
	const manifest = parseBatchManifest(resolvedBatch.definition.manifest);
	const resolvedInput = await resolveRunItems(
		scoped,
		resolvedBatch.definition,
		options.input,
	);
	validateItems(resolvedInput.items);
	if (resolvedInput.items.length === 0) {
		throw new Error("A batch run requires at least one dataset item");
	}
	const preparedRequests = prepareBatchRequests(manifest, resolvedInput.items);

	const provider = manifest.model.provider as BatchProvider;
	const adapter = options.providers[provider];
	if (!adapter)
		throw new Error(`Batch provider '${provider}' is not configured`);
	const config = await resolveProviderConfig(scoped, provider);
	const createdAt = new Date().toISOString();
	const runId = `batchrun_${randomUUID().replace(/-/g, "")}`;
	const counts = emptyCounts(resolvedInput.items.length);
	const run: BatchRun = {
		id: runId,
		batchId: resolvedBatch.definition.id,
		requestedBatchVersion: options.input.batchVersion,
		batchVersion: resolvedBatch.version,
		datasetId: resolvedInput.dataset?.id,
		requestedDatasetVersion: options.input.datasetVersion,
		datasetVersion: resolvedInput.dataset?.version,
		provider,
		model: manifest.model.name,
		status: "submitting",
		counts,
		snapshot: {
			batch: resolvedBatch.definition,
			...(resolvedInput.dataset
				? { dataset: datasetSnapshot(resolvedInput.dataset) }
				: { inlineDataset: true }),
		},
		callbackUrl: options.input.callbackUrl,
		webhookSecretName: options.input.webhookSecretName,
		idempotencyKey: options.input.idempotencyKey,
		createdAt,
		syncAttempts: 0,
	};
	const pendingItems: BatchRunItem[] = resolvedInput.items.map(
		(item, ordinal) => ({
			runId,
			itemId: item.id,
			ordinal,
			name: item.name,
			input: item.input,
			metadata: item.metadata,
			status: "pending",
		}),
	);
	try {
		await scoped.putBatchRun(run);
	} catch (error) {
		if (options.input.idempotencyKey) {
			const concurrent = await scoped.getBatchRunByIdempotencyKey(
				options.input.idempotencyKey,
			);
			if (concurrent) return concurrent;
		}
		throw error;
	}
	await scoped.putBatchRunItems(runId, pendingItems);

	try {
		const submission = await adapter.submit({
			config,
			runId,
			manifest,
			requests: preparedRequests,
		});
		const submittedAt = new Date().toISOString();
		const queued: BatchRun = {
			...run,
			providerBatchId: submission.id,
			providerStatus: submission.status,
			status: "queued",
			submittedAt,
			providerExpiresAt: submission.expiresAt,
			nextPollAt: submittedAt,
		};
		await scoped.putBatchRun(queued);
		return queued;
	} catch (error) {
		const failed: BatchRun = {
			...run,
			status: "failed",
			endedAt: new Date().toISOString(),
			error: errorMessage(error),
		};
		await scoped.putBatchRun(failed);
		throw Object.assign(
			error instanceof Error ? error : new Error(String(error)),
			{
				batchRun: failed,
			},
		);
	}
}

export async function cancelBatchRun(options: {
	store: AgntzStore;
	userId: string;
	providers: BatchProviderRegistry;
	runId: string;
}): Promise<BatchRun> {
	const scoped = options.store.forUser(options.userId);
	const run = await scoped.getBatchRun(options.runId);
	if (!run)
		throw Object.assign(new Error("Batch run not found"), {
			code: "NOT_FOUND",
		});
	if (isTerminal(run.status)) return run;
	if (!run.providerBatchId) {
		const cancelled = {
			...run,
			status: "cancelled" as const,
			endedAt: new Date().toISOString(),
			nextPollAt: undefined,
		};
		await scoped.putBatchRun(cancelled);
		return cancelled;
	}
	const provider = run.provider as BatchProvider;
	const config = await resolveProviderConfig(scoped, provider);
	await options.providers[provider].cancel(config, run.providerBatchId);
	const cancelling: BatchRun = {
		...run,
		status: "cancelling",
		nextPollAt: new Date().toISOString(),
	};
	await scoped.putBatchRun(cancelling);
	return cancelling;
}

export async function reconcileBatchRuns(options: {
	store: AgntzStore;
	providers: BatchProviderRegistry;
	workerId: string;
	limit?: number;
	onTerminal?: (ownerId: string, run: BatchRun) => Promise<void>;
}): Promise<{ claimed: number; updated: number; failed: number }> {
	const now = new Date();
	const claims = await options.store.claimBatchRuns({
		workerId: options.workerId,
		now: now.toISOString(),
		leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
		limit: options.limit,
	});
	let updated = 0;
	let failed = 0;
	for (const claim of claims) {
		try {
			const run = isTerminal(claim.run.status)
				? claim.run
				: await reconcileOne(
						options.store.forUser(claim.ownerId),
						claim.run,
						options.providers,
					);
			if (!isTerminal(claim.run.status)) updated++;
			if (
				isTerminal(run.status) &&
				run.callbackUrl &&
				run.webhookSecretName &&
				!run.terminalWebhookQueuedAt &&
				options.onTerminal
			) {
				await options.onTerminal(claim.ownerId, run);
				await options.store.forUser(claim.ownerId).putBatchRun({
					...run,
					terminalWebhookQueuedAt: new Date().toISOString(),
				});
			}
		} catch (error) {
			failed++;
			const scoped = options.store.forUser(claim.ownerId);
			const attempt = (claim.run.syncAttempts ?? 0) + 1;
			await scoped.putBatchRun({
				...claim.run,
				lastSyncAt: new Date().toISOString(),
				lastSyncError: errorMessage(error),
				syncAttempts: attempt,
				nextPollAt: nextPollAt(attempt),
			});
		}
	}
	return { claimed: claims.length, updated, failed };
}

async function reconcileOne(
	store: UnifiedStore,
	run: BatchRun,
	providers: BatchProviderRegistry,
): Promise<BatchRun> {
	if (!run.providerBatchId) {
		throw new Error(`Batch run '${run.id}' has no provider batch ID`);
	}
	const provider = run.provider as BatchProvider;
	const adapter = providers[provider];
	if (!adapter) throw new Error(`Unknown batch provider '${provider}'`);
	const config = await resolveProviderConfig(store, provider);
	const state = await adapter.get(config, run.providerBatchId);
	const syncAttempts = (run.syncAttempts ?? 0) + 1;
	let next: BatchRun = {
		...run,
		providerStatus: state.status,
		providerExpiresAt: state.expiresAt ?? run.providerExpiresAt,
		startedAt: state.startedAt ?? run.startedAt,
		lastSyncAt: new Date().toISOString(),
		lastSyncError: undefined,
		syncAttempts,
		status: state.terminal
			? (state.outcome ?? "failed")
			: providerRunStatus(run, state),
		counts: mergeCounts(run.counts, state.counts),
		nextPollAt: state.terminal ? undefined : nextPollAt(syncAttempts),
		endedAt: state.terminal
			? (state.endedAt ?? new Date().toISOString())
			: run.endedAt,
		error: state.outcome === "failed" ? (state.error ?? run.error) : run.error,
	};

	if (state.terminal) {
		const currentItems = await loadAllRunItems(store, run.id);
		if (state.outcome === "completed") {
			const results = await adapter.results(config, state);
			const byId = new Map(results.map((result) => [result.itemId, result]));
			const finalItems = currentItems.map((item) => {
				const result = byId.get(item.itemId);
				return result
					? { ...item, ...result, runId: run.id, itemId: item.itemId }
					: {
							...item,
							status: "failed" as const,
							error: "Provider did not return a result for this item",
						};
			});
			await store.putBatchRunItems(run.id, finalItems);
			next = { ...next, counts: countItems(finalItems), status: "completed" };
		} else {
			const itemStatus =
				state.outcome === "cancelled"
					? ("cancelled" as const)
					: state.outcome === "expired"
						? ("expired" as const)
						: ("failed" as const);
			const finalItems = currentItems.map((item) =>
				item.status === "pending"
					? { ...item, status: itemStatus, error: state.error }
					: item,
			);
			await store.putBatchRunItems(run.id, finalItems);
			next = { ...next, counts: countItems(finalItems) };
		}
	}
	await store.putBatchRun(next);
	return next;
}

async function resolveBatch(
	store: UnifiedStore,
	batchId: string,
	requestedVersion?: string,
): Promise<{ definition: BatchDefinition; version: string }> {
	if (!requestedVersion) {
		const definition = await store.getBatch(batchId);
		if (!definition?.version) {
			throw Object.assign(new Error(`Batch '${batchId}' not found`), {
				code: "NOT_FOUND",
			});
		}
		return { definition, version: definition.version };
	}
	const version =
		(await store.resolveBatchVersionAlias(batchId, requestedVersion)) ??
		requestedVersion;
	const definition = await store.getBatchVersion(batchId, version);
	if (!definition) {
		throw Object.assign(
			new Error(`Batch version '${batchId}@${requestedVersion}' not found`),
			{ code: "NOT_FOUND" },
		);
	}
	return { definition: { ...definition, version }, version };
}

async function resolveRunItems(
	store: UnifiedStore,
	batch: BatchDefinition,
	input: SubmitBatchRunInput,
): Promise<{ items: DatasetItem[]; dataset?: Dataset }> {
	if (input.items && input.datasetId) {
		throw new Error("Pass either inline items or datasetId, not both");
	}
	if (input.items) return { items: input.items };
	const datasetId = input.datasetId ?? batch.defaultDataset?.id;
	if (!datasetId) {
		throw new Error(
			`Batch '${batch.id}' has no default dataset; pass datasetId or items`,
		);
	}
	const requestedVersion =
		input.datasetVersion ??
		(input.datasetId ? undefined : batch.defaultDataset?.version);
	let dataset: Dataset | null;
	if (requestedVersion) {
		const version =
			(await store.resolveDatasetVersionAlias(datasetId, requestedVersion)) ??
			requestedVersion;
		dataset = await store.getDatasetVersion(datasetId, version);
	} else {
		dataset = await store.getDataset(datasetId);
	}
	if (!dataset) {
		throw Object.assign(new Error(`Dataset '${datasetId}' not found`), {
			code: "NOT_FOUND",
		});
	}
	const items = await loadAllDatasetItems(store, dataset.id, dataset.version);
	return { dataset: { ...dataset, items }, items };
}

async function loadAllDatasetItems(
	store: UnifiedStore,
	datasetId: string,
	version?: string,
): Promise<DatasetItem[]> {
	const rows: DatasetItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await store.listDatasetItems(datasetId, {
			version,
			cursor,
			limit: 1_000,
		});
		rows.push(...page.rows);
		cursor = page.cursor;
	} while (cursor);
	return rows;
}

async function loadAllRunItems(
	store: UnifiedStore,
	runId: string,
): Promise<BatchRunItem[]> {
	const rows: BatchRunItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await store.listBatchRunItems(runId, {
			cursor,
			limit: 1_000,
		});
		rows.push(...page.rows);
		cursor = page.cursor;
	} while (cursor);
	return rows;
}

async function resolveProviderConfig(
	store: UnifiedStore,
	provider: BatchProvider,
): Promise<ProviderConfig> {
	const stored = await store.getProvider(provider);
	if (stored?.apiKey) return stored;
	const envName: Record<BatchProvider, string> = {
		openai: "OPENAI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		google: "GOOGLE_GENERATIVE_AI_API_KEY",
		mistral: "MISTRAL_API_KEY",
	};
	const apiKey = process.env[envName[provider]];
	if (!apiKey) {
		throw new Error(
			`Provider '${provider}' is not configured (missing ${envName[provider]})`,
		);
	}
	return { id: provider, apiKey };
}

function validateItems(items: DatasetItem[]): void {
	const ids = new Set<string>();
	for (const [index, item] of items.entries()) {
		if (!item || typeof item !== "object") {
			throw new Error(`items[${index}] must be an object`);
		}
		if (typeof item.id !== "string" || item.id.length === 0) {
			throw new Error(`items[${index}].id must be a non-empty string`);
		}
		if (ids.has(item.id))
			throw new Error(`Duplicate dataset item id '${item.id}'`);
		ids.add(item.id);
		if (item.input === undefined) {
			throw new Error(`items[${index}].input is required`);
		}
	}
}

function datasetSnapshot(
	dataset: Dataset,
): Omit<Dataset, "items"> & { itemCount: number } {
	const { items, ...snapshot } = dataset;
	return { ...snapshot, itemCount: dataset.itemCount ?? items.length };
}

function emptyCounts(total: number): BatchRequestCounts {
	return {
		total,
		pending: total,
		succeeded: 0,
		failed: 0,
		expired: 0,
		cancelled: 0,
	};
}

function mergeCounts(
	current: BatchRequestCounts,
	patch: Partial<BatchRequestCounts> | undefined,
): BatchRequestCounts {
	if (!patch) return current;
	const next = { ...current, ...patch };
	next.pending =
		patch.pending ??
		Math.max(
			0,
			next.total - next.succeeded - next.failed - next.expired - next.cancelled,
		);
	return next;
}

function countItems(items: BatchRunItem[]): BatchRequestCounts {
	const counts = emptyCounts(items.length);
	counts.pending = 0;
	for (const item of items) {
		if (item.status === "pending") counts.pending++;
		else counts[item.status]++;
	}
	return counts;
}

function providerRunStatus(
	run: BatchRun,
	state: ProviderBatchState,
): BatchRun["status"] {
	if (run.status === "cancelling") return "cancelling";
	const status = state.status.toLowerCase();
	if (
		status.includes("progress") ||
		status.includes("running") ||
		status.includes("started")
	) {
		return "running";
	}
	return "queued";
}

function nextPollAt(attempt: number): string {
	const delay = Math.min(
		15 * 60_000,
		Math.max(15_000, 15_000 * 2 ** Math.min(attempt, 6)),
	);
	return new Date(Date.now() + delay).toISOString();
}

function isTerminal(status: BatchRun["status"]): boolean {
	return (
		status === "completed" ||
		status === "failed" ||
		status === "expired" ||
		status === "cancelled"
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
