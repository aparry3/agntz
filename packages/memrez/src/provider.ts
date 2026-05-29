import type { ResourceProvider, ResourceToolContext } from "@agntz/core";
import { z } from "zod";
import type { Memrez } from "./memrez.js";
import type { EntryType, WritePolicy } from "./types.js";

const ReadInput = z.object({
	topic: z.string().describe("Topic to read from memory."),
	limit: z.number().int().positive().max(50).optional(),
});

const WriteInput = z.object({
	content: z.string().describe("Finished fact or preference to remember."),
	type: z.enum(["fact", "preference", "event", "summary"]).optional(),
	topicsHint: z.array(z.string()).optional(),
});

export interface MemoryResourceConfig {
	mode?: "read" | "read-write";
	autoScan?: boolean;
	writePolicy?: WritePolicy;
	[key: string]: unknown;
}

export function createMemoryResourceProvider(memrez: Memrez): ResourceProvider {
	return {
		defaultMode: "read-write",
		async getContext(ctx) {
			const config = ctx.config as MemoryResourceConfig;
			if (config.autoScan === false) return undefined;
			const scan = await memrez.scan(ctx.grants);
			if (scan.topics.length === 0) {
				return "Memory topics: none.";
			}
			const lines = scan.topics.map((topic) => {
				const blurb = topic.blurb ? ` - ${topic.blurb}` : "";
				return `- ${topic.topic} (${topic.count})${blurb}`;
			});
			return `Memory topics visible to this run:\n${lines.join("\n")}`;
		},
		tools() {
			return [
				{
					name: "read",
					description: "Read memory entries for a topic visible to this run.",
					input: ReadInput,
					async execute(input: z.infer<typeof ReadInput>, ctx) {
						return memrez.read(ctx.grants, input.topic, { limit: input.limit });
					},
				},
				{
					name: "write",
					description:
						"Write a durable memory fact. The memory resource chooses and validates the namespace.",
					mode: "read-write" as const,
					input: WriteInput,
					async execute(
						input: z.infer<typeof WriteInput>,
						ctx: ResourceToolContext,
					) {
						const config = ctx.config as MemoryResourceConfig;
						return memrez.write(ctx.grants, input.content, {
							type: input.type as EntryType | undefined,
							topicsHint: input.topicsHint,
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
