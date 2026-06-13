import type { ResourceProvider, ResourceToolContext } from "@agntz/core";
import { z } from "zod";
import type { Memrez } from "./memrez.js";
import type { EntryType, MemoryEntry, WritePolicy } from "./types.js";

const ReadInput = z.object({
	topics: z
		.union([z.string(), z.array(z.string()).min(1)])
		.optional()
		.describe("Topic or list of topics to read from memory."),
	topic: z
		.string()
		.optional()
		.describe("Single topic to read (legacy alias of topics)."),
	limit: z
		.number()
		.int()
		.positive()
		.max(50)
		.optional()
		.describe("Max entries returned per topic."),
});

// Content only, deliberately: organizing memory (scope, topics, type, dedup)
// is memrez's job via its reasoner, not the calling agent's. Programmatic
// callers can still steer through WriteOptions.topicsHint.
const WriteInput = z.object({
	content: z.string().describe("Finished fact or preference to remember."),
});

export interface MemoryResourceConfig {
	mode?: "read" | "read-write";
	autoScan?: boolean;
	/**
	 * Inline full entries into the run context at invoke time. `true` means the
	 * Memrez core topic. "all" means every visible active durable entry.
	 * A topic array is a legacy shorthand for core + those topics. The object
	 * form is canonical:
	 * { core?: boolean, topics?: string[] | "all", limit?: number,
	 *   maxChars?: number, types?: EntryType[] }.
	 */
	preload?: boolean | "all" | string[] | MemoryPreloadConfig;
	/**
	 * Legacy entry cap across preloaded topics. Prefer preload.limit.
	 */
	preloadLimit?: number;
	writePolicy?: WritePolicy;
	[key: string]: unknown;
}

export interface MemoryPreloadConfig {
	core?: boolean;
	topics?: "all" | string[];
	limit?: number;
	maxChars?: number;
	types?: EntryType[];
}

interface NormalizedPreloadConfig {
	all: boolean;
	topics: string[];
	limit: number;
	maxChars: number;
	types?: EntryType[];
}

const DEFAULT_CORE_TOPIC = "core";
const DEFAULT_PRELOAD_LIMIT = 50;
const MAX_PRELOAD_LIMIT = 200;
const DEFAULT_PRELOAD_MAX_CHARS = 12_000;
const MAX_PRELOAD_MAX_CHARS = 50_000;
const DEFAULT_ALL_PRELOAD_TYPES: EntryType[] = [
	"fact",
	"preference",
	"summary",
];
const ENTRY_TYPES = new Set<EntryType>([
	"fact",
	"preference",
	"event",
	"summary",
]);

export function createMemoryResourceProvider(memrez: Memrez): ResourceProvider {
	return {
		defaultMode: "read-write",
		async getContext(ctx) {
			const config = ctx.config as MemoryResourceConfig;
			assertNoAgentTopicConfig(config);
			const sections: string[] = [];

			if (config.autoScan !== false) {
				const scan = await memrez.scan(ctx.grants);
				if (scan.topics.length === 0) {
					sections.push("Memory topics: none.");
				} else {
					const lines = scan.topics.map((topic) => {
						const blurb = topic.blurb ? ` - ${topic.blurb}` : "";
						return `- ${topic.topic} (${topic.count})${blurb}`;
					});
					sections.push(
						`Memory topics visible to this run:\n${lines.join("\n")}`,
					);
				}
			}

			const preload = normalizePreloadConfig(config);
			if (preload) {
				const preloaded = await preloadEntries(memrez, ctx, preload);
				if (preloaded) sections.push(preloaded);
			}

			return sections.length > 0 ? sections.join("\n\n") : undefined;
		},
		tools() {
			return [
				{
					name: "read",
					description:
						"Read memory entries for one or more topics visible to this run.",
					input: ReadInput,
					async execute(input: z.infer<typeof ReadInput>, ctx) {
						const topics = normalizeReadTopics(input);
						if (topics.length === 0) {
							throw new Error(
								"memory_read requires `topics` (string or array of strings)",
							);
						}
						return memrez.read(ctx.grants, topics, { limit: input.limit });
					},
				},
				{
					name: "write",
					description:
						"Remember something durable. Memory organization (namespace, topics, type) is handled for you — just pass the finished content.",
					mode: "read-write" as const,
					input: WriteInput,
					async execute(
						input: z.infer<typeof WriteInput>,
						ctx: ResourceToolContext,
					) {
						const config = ctx.config as MemoryResourceConfig;
						assertNoAgentTopicConfig(config);
						return memrez.write(ctx.grants, input.content, {
							writePolicy: config.writePolicy,
							source: {
								agentId: ctx.run.agentId,
								sessionId: ctx.run.sessionId,
								runId: ctx.run.runId,
							},
						});
					},
				},
			];
		},
	};
}

function normalizeReadTopics(input: z.infer<typeof ReadInput>): string[] {
	const raw =
		input.topics !== undefined
			? Array.isArray(input.topics)
				? input.topics
				: [input.topics]
			: input.topic !== undefined
				? [input.topic]
				: [];
	return raw.map((topic) => topic.trim()).filter((topic) => topic.length > 0);
}

/** Render full entries beneath the topic list so obvious context is in-scope. */
async function preloadEntries(
	memrez: Memrez,
	ctx: ResourceToolContext,
	preload: NormalizedPreloadConfig,
): Promise<string | undefined> {
	const entries = await memrez.list(ctx.grants, {
		topics: preload.all ? undefined : preload.topics,
	});
	const selected = preload.types
		? entries.filter((entry) => preload.types?.includes(entry.type))
		: entries;
	if (selected.length === 0) return undefined;

	const rendered = renderPreloadedEntries(selected, preload);
	if (rendered.lines.length === 0) return undefined;
	const omitted = selected.length - rendered.shown;
	const lines = [...rendered.lines];
	if (omitted > 0) {
		lines.push(`... ${omitted} more entries not shown; use memory_read.`);
	}
	return `Preloaded memory entries (most recent first):\n${lines.join("\n")}`;
}

function formatPreloadedEntry(entry: MemoryEntry): string {
	return `- [${entry.topics.join(", ")}] ${entry.content}`;
}

function renderPreloadedEntries(
	entries: MemoryEntry[],
	preload: NormalizedPreloadConfig,
): { lines: string[]; shown: number } {
	const lines: string[] = [];
	let used = 0;
	let shown = 0;
	for (const entry of entries) {
		if (shown >= preload.limit) break;
		const rawLine = formatPreloadedEntry(entry);
		const separator = lines.length === 0 ? "" : "\n";
		const nextLength = used + separator.length + rawLine.length;
		if (nextLength <= preload.maxChars) {
			lines.push(rawLine);
			used = nextLength;
			shown += 1;
			continue;
		}
		const remaining = preload.maxChars - used - separator.length;
		if (remaining > 20 && lines.length === 0) {
			lines.push(`${rawLine.slice(0, remaining - 3)}...`);
			shown += 1;
		}
		break;
	}
	return { lines, shown };
}

function normalizePreloadConfig(
	config: MemoryResourceConfig,
): NormalizedPreloadConfig | undefined {
	const raw = config.preload;
	if (raw === undefined || raw === false) return undefined;

	const legacyLimit =
		config.preloadLimit === undefined
			? undefined
			: normalizePositiveInt(
					config.preloadLimit,
					"memory.preloadLimit",
					MAX_PRELOAD_LIMIT,
				);

	if (raw === true) {
		return {
			all: false,
			topics: [DEFAULT_CORE_TOPIC],
			limit: legacyLimit ?? DEFAULT_PRELOAD_LIMIT,
			maxChars: DEFAULT_PRELOAD_MAX_CHARS,
		};
	}

	if (raw === "all") {
		return {
			all: true,
			topics: [],
			limit: legacyLimit ?? DEFAULT_PRELOAD_LIMIT,
			maxChars: DEFAULT_PRELOAD_MAX_CHARS,
			types: DEFAULT_ALL_PRELOAD_TYPES,
		};
	}

	if (typeof raw === "string") {
		throw new Error('memory.preload string value must be "all"');
	}

	if (Array.isArray(raw)) {
		const topics = uniqueTopics([
			DEFAULT_CORE_TOPIC,
			...normalizeTopicList(raw, "memory.preload"),
		]);
		return {
			all: false,
			topics,
			limit: legacyLimit ?? DEFAULT_PRELOAD_LIMIT,
			maxChars: DEFAULT_PRELOAD_MAX_CHARS,
		};
	}

	assertPlainObject(raw, "memory.preload");
	rejectUnknownKeys(
		raw,
		["core", "topics", "limit", "maxChars", "types"],
		"memory.preload",
	);

	const core = raw.core ?? false;
	if (typeof core !== "boolean") {
		throw new Error("memory.preload.core must be boolean when provided");
	}

	const all = raw.topics === "all";
	const configuredTopics =
		raw.topics === undefined || raw.topics === "all"
			? []
			: normalizeTopicList(raw.topics, "memory.preload.topics");
	if (
		raw.topics !== undefined &&
		raw.topics !== "all" &&
		!Array.isArray(raw.topics)
	) {
		throw new Error('memory.preload.topics must be "all" or a topic array');
	}

	const topics = uniqueTopics([
		...(core ? [DEFAULT_CORE_TOPIC] : []),
		...configuredTopics,
	]);
	if (!all && topics.length === 0) return undefined;

	return {
		all,
		topics,
		limit:
			raw.limit === undefined
				? (legacyLimit ?? DEFAULT_PRELOAD_LIMIT)
				: normalizePositiveInt(
						raw.limit,
						"memory.preload.limit",
						MAX_PRELOAD_LIMIT,
					),
		maxChars:
			raw.maxChars === undefined
				? DEFAULT_PRELOAD_MAX_CHARS
				: normalizePositiveInt(
						raw.maxChars,
						"memory.preload.maxChars",
						MAX_PRELOAD_MAX_CHARS,
					),
		types:
			raw.types === undefined
				? all
					? DEFAULT_ALL_PRELOAD_TYPES
					: undefined
				: normalizeEntryTypes(raw.types),
	};
}

function assertNoAgentTopicConfig(config: MemoryResourceConfig): void {
	if (Object.prototype.hasOwnProperty.call(config, "topics")) {
		throw new Error(
			"memory.topics is no longer supported in agent resource config; use memory.preload.topics for preload slices and configure taxonomy at the Memrez level",
		);
	}
}

function normalizePositiveInt(
	value: unknown,
	path: string,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${path} must be a positive integer`);
	}
	return Math.min(value, max);
}

function normalizeEntryTypes(raw: unknown): EntryType[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error(
			"memory.preload.types must be a non-empty entry type array",
		);
	}
	const out: EntryType[] = [];
	for (const value of raw) {
		if (typeof value !== "string" || !ENTRY_TYPES.has(value as EntryType)) {
			throw new Error(
				"memory.preload.types must contain only fact, preference, event, or summary",
			);
		}
		if (!out.includes(value as EntryType)) out.push(value as EntryType);
	}
	return out;
}

function normalizeTopicList(raw: unknown, path: string): string[] {
	if (!Array.isArray(raw)) {
		throw new Error(`${path} must be an array of topic strings`);
	}
	const out = raw.map((topic, index) =>
		normalizeTopicName(topic, `${path}[${index}]`),
	);
	return uniqueTopics(out);
}

function normalizeTopicName(raw: unknown, path: string): string {
	if (typeof raw !== "string") {
		throw new Error(`${path} must be a topic string`);
	}
	const topic = raw.trim().toLowerCase();
	if (topic.length === 0) throw new Error(`${path} must not be empty`);
	return topic;
}

function uniqueTopics(topics: string[]): string[] {
	return [...new Set(topics)];
}

function assertPlainObject(
	value: unknown,
	path: string,
): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
}

function rejectUnknownKeys(
	value: Record<string, unknown>,
	allowedKeys: string[],
	path: string,
): void {
	const allowed = new Set(allowedKeys);
	const unknown = Object.keys(value).filter((key) => !allowed.has(key));
	if (unknown.length > 0) {
		throw new Error(`${path} has unsupported keys: ${unknown.join(", ")}`);
	}
}
