import { randomUUID } from "node:crypto";
import type { NamespaceGrantPolicy, ResourceProvider } from "@agntz/core";
import {
	assertWritableScope,
	normalizeGrants,
	normalizeWritePolicy,
	visibleScopes,
} from "./grants.js";
import { llmReasoner } from "./llm-reasoner.js";
import { createMemoryResourceProvider } from "./provider.js";
import { InMemoryMemoryStore } from "./store.js";
import type {
	CurateOptions,
	CurateReport,
	EntryType,
	ListOptions,
	MemoryEntry,
	MemoryStore,
	MemrezOptions,
	MemrezReasoner,
	NamespaceGrant,
	ReadOptions,
	ScanOptions,
	TaggerInput,
	TaggerResult,
	TopicSummary,
	WriteOptions,
} from "./types.js";

export class Memrez {
	readonly store: MemoryStore;
	readonly reasoner: MemrezReasoner;
	readonly namespacePolicy: NamespaceGrantPolicy | undefined;

	constructor(options: MemrezOptions = {}) {
		this.store = options.store ?? new InMemoryMemoryStore();
		// Memory handling is memrez's job: by default every write is tagged and
		// every curate pass is reasoned by the built-in LLM reasoner (direct
		// model calls, env-key auth). Pass `reasoner` to override — e.g.
		// llmReasoner({ taggerModel, curatorModel }) for custom models, or
		// DeterministicReasoner for tests / kill-switch behavior.
		this.reasoner = options.reasoner ?? llmReasoner();
		this.namespacePolicy = options.namespacePolicy;
	}

	provider(): ResourceProvider {
		return createMemoryResourceProvider(this);
	}

	async scan(
		grants: NamespaceGrant[],
		opts: ScanOptions = {},
	): Promise<{ grants: NamespaceGrant[]; topics: TopicSummary[] }> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const scopes = visibleScopes(normalized, opts.includeAncestors ?? true);
		const topics = await this.store.listTopics(scopes);
		return {
			grants: normalized,
			topics: opts.topicLimit ? topics.slice(0, opts.topicLimit) : topics,
		};
	}

	async read(
		grants: NamespaceGrant[],
		topic: string | string[],
		opts: ReadOptions = {},
	): Promise<MemoryEntry[]> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const scopes = visibleScopes(normalized, opts.includeAncestors ?? true);
		const topics = Array.isArray(topic) ? topic : [topic];
		// Loop per topic so `limit` keeps its per-topic semantics, then dedupe
		// entries tagged with more than one of the requested topics.
		const seen = new Set<string>();
		const out: MemoryEntry[] = [];
		for (const t of topics) {
			const entries = await this.store.getByTopic(scopes, t, opts.limit);
			for (const entry of entries) {
				if (seen.has(entry.id)) continue;
				seen.add(entry.id);
				out.push(entry);
			}
		}
		return out;
	}

	/**
	 * Deterministic read of every entry visible to the given grants — the
	 * viewer/audit primitive. `includeSuperseded: true` returns supersession
	 * chains as well as active entries.
	 */
	async list(
		grants: NamespaceGrant[],
		opts: ListOptions = {},
	): Promise<MemoryEntry[]> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const scopes = visibleScopes(normalized, opts.includeAncestors ?? true);
		return this.store.listScopeSlice(scopes, {
			topics: opts.topics,
			includeSuperseded: opts.includeSuperseded,
		});
	}

	async write(
		grants: NamespaceGrant[],
		content: string,
		opts: WriteOptions = {},
	): Promise<{
		entry: MemoryEntry;
		action: "appended" | "superseded" | "deduped";
	}> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const writePolicy = normalizeWritePolicy(opts.writePolicy);
		const existingTopics = (await this.scan(normalized)).topics.map(
			(topic) => topic.topic,
		);
		const tag = await this.reasoner.tag({
			grants: normalized,
			content,
			existingTopics,
			topicsHint: opts.topicsHint,
			topicConfig: opts.topicConfig,
			writePolicy,
			source: opts.source,
		});
		const scope = assertWritableScope(normalized, tag.namespace, writePolicy);

		if (tag.duplicateOf) {
			const duplicate = await this.store.getEntry(tag.duplicateOf);
			if (duplicate) return { entry: duplicate, action: "deduped" };
		}

		const exactDuplicate = await this.findExactDuplicate(
			scope,
			tag.normalizedContent,
		);
		if (exactDuplicate) {
			return { entry: exactDuplicate, action: "deduped" };
		}

		const now = new Date().toISOString();
		const entry: MemoryEntry = {
			id: `mem_${randomUUID()}`,
			scope,
			content: tag.normalizedContent,
			topics: normalizeTopics(tag.topics),
			type: opts.type ?? tag.type,
			source: opts.source,
			status: "active",
			createdAt: now,
			updatedAt: now,
		};
		await this.store.putEntry(entry);
		return { entry, action: "appended" };
	}

	async curate(
		grants: NamespaceGrant[],
		opts: CurateOptions = {},
	): Promise<CurateReport> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const scopePaths = opts.includeDescendants
			? normalized
			: visibleScopes(normalized, true);
		const entries = await this.store.listScopeSlice(scopePaths, {
			topics: opts.topics,
		});
		const ops = this.reasoner.curate
			? await this.reasoner.curate({
					grants: normalized,
					scopePaths,
					entries,
					topics: opts.topics,
					topicConfig: opts.topicConfig,
				})
			: [];

		const report: CurateReport = {
			scanned: entries.length,
			superseded: 0,
			created: 0,
			blurbsUpdated: 0,
		};

		// (scope, topic) pairs covered by this pass. Touched below so dirty
		// tracking (listDirtyTopics / hasUncuratedWrites) resets even for
		// topics the curator left untouched.
		const curatedPairs = new Map<string, { scope: string; topic: string }>();
		for (const entry of entries) {
			for (const topic of entry.topics) {
				if (opts.topics && !opts.topics.includes(topic)) continue;
				curatedPairs.set(`${entry.scope}\u0000${topic}`, {
					scope: entry.scope,
					topic,
				});
			}
		}

		for (const op of ops) {
			if (op.type === "setBlurb") {
				await this.store.setTopicMeta(op.scope, op.topic, {
					blurb: op.blurb,
					lastUpdatedAt: new Date().toISOString(),
				});
				report.blurbsUpdated += 1;
			} else if (op.type === "supersede") {
				const scope = assertWritableScope(
					normalized,
					op.replacement.namespace,
					normalizeWritePolicy(undefined),
				);
				const now = new Date().toISOString();
				const replacement: MemoryEntry = {
					id: `mem_${randomUUID()}`,
					scope,
					content: op.replacement.content,
					topics: normalizeTopics(op.replacement.topics),
					type: op.replacement.entryType ?? "fact",
					status: "active",
					createdAt: now,
					updatedAt: now,
				};
				await this.store.putEntry(replacement);
				await this.store.supersede(op.ids, replacement.id);
				for (const topic of replacement.topics) {
					curatedPairs.set(`${scope}\u0000${topic}`, { scope, topic });
				}
				report.created += 1;
				report.superseded += op.ids.length;
			}
		}

		// Stamp the pass only when a real curator ran; the deterministic
		// no-op fallback must leave topics dirty for a future LLM pass.
		if (this.reasoner.curate) {
			const stamp = new Date().toISOString();
			for (const { scope, topic } of curatedPairs.values()) {
				const existing = await this.store.getTopicMeta(scope, topic);
				await this.store.setTopicMeta(scope, topic, {
					blurb: existing?.blurb,
					lastUpdatedAt: stamp,
				});
			}
		}

		return report;
	}

	/**
	 * Correct an entry's content without changing what it means to the
	 * organizer: the replacement inherits the original's scope, topics, and
	 * type, and the original is superseded — never edited in place — so the
	 * audit trail stays intact. Deterministic; the tagger is not consulted.
	 */
	async correct(
		grants: NamespaceGrant[],
		id: string,
		newContent: string,
	): Promise<{ entry: MemoryEntry }> {
		const normalized = normalizeGrants(grants, this.namespacePolicy);
		const original = await this.store.getEntry(id);
		if (!original) {
			throw new MemrezEntryNotFoundError(id);
		}
		if (original.status !== "active") {
			throw new MemrezCorrectionError(
				`entry '${id}' is already superseded by '${original.supersededBy}'; correct the active entry instead`,
			);
		}
		assertWritableScope(
			normalized,
			original.scope,
			normalizeWritePolicy(undefined),
		);

		const content = newContent.trim();
		if (!content) {
			throw new MemrezCorrectionError("corrected content must not be empty");
		}

		const now = new Date().toISOString();
		const entry: MemoryEntry = {
			id: `mem_${randomUUID()}`,
			scope: original.scope,
			content,
			topics: [...original.topics],
			type: original.type,
			status: "active",
			createdAt: now,
			updatedAt: now,
		};
		await this.store.putEntry(entry);
		await this.store.supersede([id], entry.id);
		return { entry };
	}

	private async findExactDuplicate(
		scope: string,
		content: string,
	): Promise<MemoryEntry | null> {
		const entries = await this.store.listScopeSlice([scope]);
		return (
			entries.find(
				(entry) => entry.content === content && entry.status === "active",
			) ?? null
		);
	}
}

export function createMemrez(options: MemrezOptions = {}): Memrez {
	return new Memrez(options);
}

export class MemrezEntryNotFoundError extends Error {
	constructor(id: string) {
		super(`memory entry '${id}' not found`);
		this.name = "MemrezEntryNotFoundError";
	}
}

export class MemrezCorrectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MemrezCorrectionError";
	}
}

function normalizeTopics(topics: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const topic of topics) {
		const normalized = topic.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out.length > 0 ? out : ["general"];
}
