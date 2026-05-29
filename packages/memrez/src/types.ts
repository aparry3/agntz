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

export interface WriteOptions {
	type?: EntryType;
	topicsHint?: string[];
	source?: Source;
	writePolicy?: WritePolicy;
}

export interface ReadOptions {
	limit?: number;
	includeAncestors?: boolean;
}

export interface ScanOptions {
	includeAncestors?: boolean;
	topicLimit?: number;
}

export interface CurateOptions {
	topics?: string[];
	includeDescendants?: boolean;
}

export interface TaggerInput {
	grants: NamespaceGrant[];
	content: string;
	existingTopics: string[];
	topicsHint?: string[];
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
}

export interface CurateReport {
	scanned: number;
	superseded: number;
	created: number;
	blurbsUpdated: number;
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
}

export interface MemrezOptions {
	store?: MemoryStore;
	reasoner?: MemrezReasoner;
	namespacePolicy?: NamespaceGrantPolicy;
}
