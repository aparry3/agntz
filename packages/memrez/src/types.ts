import type { ModelProvider, NamespaceGrantPolicy } from "@agntz/contracts";

export type NamespaceGrant = string;

export type EntryType = "fact" | "preference" | "event" | "summary";

export interface Source {
	agentId?: string;
	sessionId?: string;
	runId?: string;
}

export interface MemoryEntry {
	id: string;
	scope: string;
	content: string;
	topics: string[];
	type: EntryType;
	source?: Source;
	status: "active" | "superseded";
	supersededBy?: string;
	createdAt: string;
	updatedAt: string;
}

export interface TopicSummary {
	topic: string;
	count: number;
	blurb?: string;
	lastUpdatedAt: string;
	hasUncuratedWrites: boolean;
}

export interface WritePolicy {
	descendants?: boolean;
	ancestorPromotion?: "none" | "parent" | "ancestors";
}

export interface MemoryTopicConfig {
	/** Special always-load topic. Defaults to "core". */
	core?: string;
	/** Preferred domain topic vocabulary for the reasoner. */
	preferred?: string[];
}

export interface WriteOptions {
	type?: EntryType;
	topicsHint?: string[];
	topicConfig?: MemoryTopicConfig;
	source?: Source;
	writePolicy?: WritePolicy;
}

export interface ReadOptions {
	limit?: number;
	includeAncestors?: boolean;
}

export interface ListOptions {
	topics?: string[];
	includeSuperseded?: boolean;
	includeAncestors?: boolean;
}

export interface ScanOptions {
	includeAncestors?: boolean;
	topicLimit?: number;
}

export interface CurateOptions {
	topics?: string[];
	topicConfig?: MemoryTopicConfig;
	includeDescendants?: boolean;
}

export interface TaggerInput {
	grants: NamespaceGrant[];
	content: string;
	existingTopics: string[];
	topicsHint?: string[];
	topicConfig?: MemoryTopicConfig;
	writePolicy: Required<WritePolicy>;
	source?: Source;
}

export interface TaggerResult {
	namespace: string;
	topics: string[];
	type: EntryType;
	normalizedContent: string;
	duplicateOf?: string;
}

export type CurateOp =
	| {
			type: "supersede";
			ids: string[];
			replacement: {
				namespace: string;
				content: string;
				topics: string[];
				entryType?: EntryType;
			};
	  }
	| {
			type: "setBlurb";
			scope: string;
			topic: string;
			blurb: string;
	  };

export interface CuratorInput {
	grants: NamespaceGrant[];
	scopePaths: string[];
	entries: MemoryEntry[];
	topics?: string[];
	topicConfig?: MemoryTopicConfig;
}

export interface CurateReport {
	scanned: number;
	superseded: number;
	created: number;
	blurbsUpdated: number;
}

/**
 * A (scope, topic) pair with active writes newer than the topic's last
 * curation pass. The unit of work for curation sweeps.
 */
export interface DirtyTopic {
	scope: string;
	topic: string;
}

export interface MemrezReasoner {
	tag(input: TaggerInput): Promise<TaggerResult>;
	curate?(input: CuratorInput): Promise<CurateOp[]>;
}

export interface DeleteScopeResult {
	/** Entry rows hard-deleted (their topic rows cascade away). */
	entries: number;
	/** topic_meta rows hard-deleted (no FK cascade — removed explicitly). */
	topicMeta: number;
}

export interface MemoryStore {
	putEntry(entry: MemoryEntry): Promise<void>;
	getEntry(id: string): Promise<MemoryEntry | null>;
	supersede(ids: string[], byId: string): Promise<void>;
	/**
	 * Hard-delete a single entry (and, via FK cascade, its topic rows). Returns
	 * true if a row was removed. Unlike `supersede`, this is irreversible erasure.
	 */
	deleteEntry(id: string): Promise<boolean>;
	/**
	 * Hard-delete every entry whose scope is exactly `scopePrefix` and, when
	 * `opts.recursive`, every scope at-or-below `scopePrefix/`. Also removes the
	 * matching `topic_meta` rows (which have no FK cascade). For GDPR-style scope
	 * erasure; safe to re-run (already-deleted rows are a no-op).
	 */
	deleteScope(
		scopePrefix: string,
		opts?: { recursive?: boolean },
	): Promise<DeleteScopeResult>;
	listTopics(scopePaths: string[]): Promise<TopicSummary[]>;
	getByTopic(
		scopePaths: string[],
		topic: string,
		limit?: number,
	): Promise<MemoryEntry[]>;
	getTopicMeta(
		scope: string,
		topic: string,
	): Promise<Omit<TopicSummary, "count"> | null>;
	setTopicMeta(
		scope: string,
		topic: string,
		meta: { blurb?: string; lastUpdatedAt?: string },
	): Promise<void>;
	listScopeSlice(
		scopePaths: string[],
		opts?: { topics?: string[]; includeSuperseded?: boolean },
	): Promise<MemoryEntry[]>;
	listEntries(opts?: { includeSuperseded?: boolean }): Promise<MemoryEntry[]>;
	/**
	 * Enumerate (scope, topic) pairs whose newest active entry postdates the
	 * topic's `topic_meta.last_updated_at` (or that have no meta row at all).
	 * Unlike every other method this takes no scopePaths — it is the global
	 * work-discovery primitive for curation crons.
	 */
	listDirtyTopics(): Promise<DirtyTopic[]>;
}

export interface MemrezOptions {
	store?: MemoryStore;
	reasoner?: MemrezReasoner;
	namespacePolicy?: NamespaceGrantPolicy;
	/**
	 * Model provider backing the default built-in reasoner's direct model calls
	 * (tagging + curation). Hosts (worker/SDK) inject their concrete provider —
	 * e.g. core's `AISDKModelProvider` — so memrez never depends on `@agntz/core`.
	 * Ignored when an explicit `reasoner` is supplied. When neither is set, the
	 * default reasoner throws a clear setup error if a model call is attempted.
	 */
	modelProvider?: ModelProvider;
}
