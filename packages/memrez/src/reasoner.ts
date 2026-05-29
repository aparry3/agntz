import type {
	CurateOp,
	CuratorInput,
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "./types.js";

export interface AgntzRunResult {
	output: unknown;
	state: Record<string, unknown>;
	sessionId: string;
}

export interface AgntzClientLike {
	agents: {
		run(input: {
			agentId: string;
			input?: unknown;
			context?: string[];
			sessionId?: string;
		}): Promise<AgntzRunResult>;
	};
}

export interface AgntzReasonerOptions {
	client: AgntzClientLike;
	taggerAgentId?: string;
	curatorAgentId?: string;
}

export function agntzReasoner(options: AgntzReasonerOptions): MemrezReasoner {
	const taggerAgentId = options.taggerAgentId ?? "memrez-tagger";
	const curatorAgentId = options.curatorAgentId ?? "memrez-curator";

	return {
		async tag(input: TaggerInput): Promise<TaggerResult> {
			const result = await options.client.agents.run({
				agentId: taggerAgentId,
				input: {
					grants: input.grants,
					content: input.content,
					existingTopics: input.existingTopics,
					topicsHint: input.topicsHint ?? [],
					writePolicy: input.writePolicy,
					source: input.source ?? null,
				},
			});
			return parseTaggerResult(result);
		},

		async curate(input: CuratorInput): Promise<CurateOp[]> {
			const result = await options.client.agents.run({
				agentId: curatorAgentId,
				input: {
					grants: input.grants,
					scopePaths: input.scopePaths,
					entries: input.entries,
					topics: input.topics ?? [],
				},
			});
			const parsed = parseOutput(result.output);
			if (
				!parsed ||
				typeof parsed !== "object" ||
				!Array.isArray((parsed as { ops?: unknown }).ops)
			) {
				throw new Error(
					"memrez curator returned invalid output: expected { ops: [] }",
				);
			}
			return (parsed as { ops: CurateOp[] }).ops;
		},
	};
}

function parseTaggerResult(result: AgntzRunResult): TaggerResult {
	const parsed = parseOutput(result.output);
	if (!parsed || typeof parsed !== "object") {
		throw new Error("memrez tagger returned invalid output: expected object");
	}
	const obj = parsed as Partial<TaggerResult>;
	if (
		typeof obj.namespace !== "string" ||
		!Array.isArray(obj.topics) ||
		!obj.topics.every((topic) => typeof topic === "string") ||
		typeof obj.type !== "string" ||
		typeof obj.normalizedContent !== "string"
	) {
		throw new Error("memrez tagger returned invalid output shape");
	}
	return {
		namespace: obj.namespace,
		topics: obj.topics,
		type: obj.type,
		normalizedContent: obj.normalizedContent,
		duplicateOf:
			typeof obj.duplicateOf === "string" ? obj.duplicateOf : undefined,
	} as TaggerResult;
}

function parseOutput(output: unknown): unknown {
	if (typeof output === "string") {
		return JSON.parse(output);
	}
	return output;
}
