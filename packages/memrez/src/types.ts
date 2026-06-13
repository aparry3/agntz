import type { NamespaceGrantPolicy } from "@agntz/core";

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

export interface MemoryStore {
	putEntry(entry: MemoryEntry): Promise<void>;
	getEntry(id: string): Promise<MemoryEntry | null>;
	supersede(ids: string[], byId: string): Promise<void>;
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
}
