import type { ResourceProvider, ResourceToolContext } from "@agntz/core";
import { z } from "zod";
import type { Memrez } from "./memrez.js";
import type { MemoryEntry, WritePolicy } from "./types.js";

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
	 * Inline full entries into the run context at invoke time. Either "all"
	 * (every active entry visible to the grants, `event` entries excluded) or
	 * an explicit topic list such as ["pinned"].
	 */
	preload?: "all" | string[];
	/** Entry cap across preloaded topics. Default 50. */
	preloadLimit?: number;
	writePolicy?: WritePolicy;
	[key: string]: unknown;
}

const DEFAULT_PRELOAD_LIMIT = 50;

export function createMemoryResourceProvider(memrez: Memrez): ResourceProvider {
	return {
		defaultMode: "read-write",
		async getContext(ctx) {
			const config = ctx.config as MemoryResourceConfig;
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

			if (config.preload) {
				const preloaded = await preloadEntries(memrez, ctx, config);
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

/**
 * Render the preload section: full entries inlined beneath the topic list so
 * the agent doesn't burn a turn recalling obvious context. `all` excludes
 * `event` entries — they accumulate linearly and would crowd out durable
 * facts; an explicit topic list is taken verbatim.
 */
async function preloadEntries(
	memrez: Memrez,
	ctx: ResourceToolContext,
	config: MemoryResourceConfig,
): Promise<string | undefined> {
	const all = config.preload === "all";
	// An empty topic list means "preload nothing", not "preload everything".
	if (!all && (config.preload as string[]).length === 0) return undefined;
	const entries = await memrez.list(ctx.grants, {
		topics: all ? undefined : (config.preload as string[]),
	});
	const selected = all
		? entries.filter((entry) => entry.type !== "event")
		: entries;
	if (selected.length === 0) return undefined;

	const limit = config.preloadLimit ?? DEFAULT_PRELOAD_LIMIT;
	const shown = selected.slice(0, limit);
	const lines = shown.map(formatPreloadedEntry);
	const omitted = selected.length - shown.length;
	if (omitted > 0) {
		lines.push(`… ${omitted} more entries not shown; use memory_read.`);
	}
	return `Preloaded memory entries (most recent first):\n${lines.join("\n")}`;
}

function formatPreloadedEntry(entry: MemoryEntry): string {
	return `- [${entry.topics.join(", ")}] ${entry.content}`;
}
