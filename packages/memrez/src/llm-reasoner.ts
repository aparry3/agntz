import { AISDKModelProvider } from "@agntz/core";
import type { ModelProvider } from "@agntz/core";
import type {
	CurateOp,
	CuratorInput,
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "./types.js";

/**
 * Built-in LLM reasoner — the default for createMemrez(). memory handling is
 * memrez's job, not the calling agent's: every write is tagged (namespace,
 * topics, type, normalization, dedup) and every curate pass is reasoned by
 * the definitions below, executed as single direct model calls through
 * core's AISDKModelProvider. No agntz client or runner is involved, so
 * memrez stays strictly below the agent layer — an agent's memory_write can
 * never re-enter the agent platform.
 *
 * This is intentionally not run through the agntz agent loop. Tagging and
 * curation are bounded structured model calls owned by memrez, which avoids
 * recursive "agent calls memory calls agent" setups.
 */

export interface ReasonerModelConfig {
	provider: string;
	name: string;
}

export interface LlmReasonerOptions {
	/** Defaults to core's AISDKModelProvider resolving keys from env vars. */
	modelProvider?: ModelProvider;
	/** Override the tagger model. Default: openai/gpt-5.4-mini. */
	taggerModel?: ReasonerModelConfig;
	/** Override the curator model. Default: openai/gpt-5.4. */
	curatorModel?: ReasonerModelConfig;
}

export const DEFAULT_TAGGER_MODEL: ReasonerModelConfig = {
	provider: "openai",
	name: "gpt-5.4-mini",
};

export const DEFAULT_CURATOR_MODEL: ReasonerModelConfig = {
	provider: "openai",
	name: "gpt-5.4",
};

const TAGGER_INSTRUCTION = `You normalize one memory fact.

Choose the most specific allowed namespace for the fact, assign concise
lowercase topics, and return strict JSON matching the schema. Never invent
data beyond the supplied content.

Reuse existing topics when one fits; only mint a new topic when none do.

The topic \`pinned\` marks the always-load set: durable profile facts an
agent should know without searching (equipment, schedule, goals, hard
constraints). Add \`pinned\` alongside the subject topic for such facts —
e.g. ["equipment", "pinned"]. Never pin transient events or one-off
details.`;

const TAGGER_OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		namespace: { type: "string" },
		topics: { type: "array", items: { type: "string" } },
		type: {
			type: "string",
			enum: ["fact", "preference", "event", "summary"],
		},
		normalizedContent: { type: "string" },
		duplicateOf: { type: ["string", "null"] },
	},
	required: ["namespace", "topics", "type", "normalizedContent"],
	additionalProperties: false,
} as const;

const CURATOR_INSTRUCTION = `You curate a bounded memory slice.

Return strict JSON with an ops array. Use supersede operations to merge
duplicates or reconcile contradictions. Use setBlurb operations to keep
topic summaries short and useful. Operate only inside the supplied grants.

A supersede op is {"type":"supersede","ids":[...],"replacement":{"namespace":string,"content":string,"topics":[string],"entryType":"fact"|"preference"|"event"|"summary"}}.
A setBlurb op is {"type":"setBlurb","scope":string,"topic":string,"blurb":string}.

Supersede accumulated \`event\` entries into a compact \`summary\` entry once
they stop carrying individual value, so scopes stay small.

The topic \`pinned\` is the always-load set of durable profile facts. You
own its hygiene: when superseding, add \`pinned\` to replacement topics to
promote a durable fact, or omit it to demote one that no longer earns
always-load status. Keep the \`pinned\` blurb a one-line profile of the
scope (e.g. "3x/week, dumbbells only, goal: strength").`;

const CURATOR_OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		ops: { type: "array", items: { type: "object" } },
	},
	required: ["ops"],
	additionalProperties: false,
} as const;

/** Env var the AI SDK reads per provider, for the fail-fast key check. */
const PROVIDER_ENV_KEYS: Record<string, string> = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	google: "GOOGLE_GENERATIVE_AI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	xai: "XAI_API_KEY",
	groq: "GROQ_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
};

export function llmReasoner(options: LlmReasonerOptions = {}): MemrezReasoner {
	const usingEnvKeys = options.modelProvider === undefined;
	const modelProvider = options.modelProvider ?? new AISDKModelProvider();
	const taggerModel = options.taggerModel ?? DEFAULT_TAGGER_MODEL;
	const curatorModel = options.curatorModel ?? DEFAULT_CURATOR_MODEL;

	return {
		async tag(input: TaggerInput): Promise<TaggerResult> {
			// A missing key is a setup bug — fail loud, never silently degrade.
			assertProviderKey(taggerModel, usingEnvKeys);
			try {
				const result = await modelProvider.generateText({
					model: taggerModel,
					messages: [
						{ role: "system", content: TAGGER_INSTRUCTION },
						{ role: "user", content: renderTaggerPrompt(input) },
					],
					outputSchema: {
						name: "memrez_tag",
						schema: { ...TAGGER_OUTPUT_SCHEMA },
					},
				});
				return parseTaggerOutput(result.text);
			} catch (err) {
				// Key is present, so this is a transient model failure — keep the
				// write landing rather than failing the agent's tool call. The
				// entry stays recoverable: curation can re-organize it later.
				console.warn(
					`[memrez] tagger model call failed, falling back to deterministic tagging: ${(err as Error).message}`,
				);
				return deterministicTag(input);
			}
		},

		async curate(input: CuratorInput): Promise<CurateOp[]> {
			assertProviderKey(curatorModel, usingEnvKeys);
			// No fallback — there is no deterministic curation. Errors propagate
			// to the curate caller (sweep/endpoint), which reports them.
			const result = await modelProvider.generateText({
				model: curatorModel,
				messages: [
					{ role: "system", content: CURATOR_INSTRUCTION },
					{ role: "user", content: renderCuratorPrompt(input) },
				],
				outputSchema: {
					name: "memrez_curate",
					schema: { ...CURATOR_OUTPUT_SCHEMA },
				},
			});
			return parseCuratorOutput(result.text);
		},
	};
}

/**
 * Deterministic tagging — the transient-failure fallback and the explicit
 * opt-out (tests, MEMREZ_REASONER=deterministic). Files content under the
 * caller's topicsHint (or "general") at the first grant; no LLM involved.
 */
export class DeterministicReasoner implements MemrezReasoner {
	async tag(input: TaggerInput): Promise<TaggerResult> {
		return deterministicTag(input);
	}
}

export function deterministicTag(input: TaggerInput): TaggerResult {
	return {
		namespace: input.grants[0],
		topics: input.topicsHint?.length ? [...input.topicsHint] : ["general"],
		type: "fact",
		normalizedContent: input.content.trim(),
	};
}

function assertProviderKey(
	model: ReasonerModelConfig,
	usingEnvKeys: boolean,
): void {
	if (!usingEnvKeys) return;
	const envKey = PROVIDER_ENV_KEYS[model.provider];
	if (!envKey || process.env[envKey]) return;
	throw new Error(
		`memrez's default reasoner needs ${envKey} for model ${model.provider}/${model.name}. Set the env var, or pass createMemrez({ reasoner }) to supply your own reasoner.`,
	);
}

function renderTaggerPrompt(input: TaggerInput): string {
	return [
		"Grants:",
		JSON.stringify(input.grants),
		"",
		"Write policy:",
		JSON.stringify(input.writePolicy),
		"",
		"Existing topics:",
		JSON.stringify(input.existingTopics),
		"",
		"Topic hints:",
		JSON.stringify(input.topicsHint ?? []),
		"",
		"Content:",
		input.content,
	].join("\n");
}

function renderCuratorPrompt(input: CuratorInput): string {
	return [
		"Grants:",
		JSON.stringify(input.grants),
		"",
		"Scope paths:",
		JSON.stringify(input.scopePaths),
		"",
		"Topics:",
		JSON.stringify(input.topics ?? []),
		"",
		"Entries:",
		JSON.stringify(input.entries, null, 2),
	].join("\n");
}

function parseTaggerOutput(text: string): TaggerResult {
	const parsed = parseJson(text, "tagger");
	const obj = parsed as Partial<TaggerResult> & { duplicateOf?: unknown };
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
		type: obj.type as TaggerResult["type"],
		normalizedContent: obj.normalizedContent,
		duplicateOf:
			typeof obj.duplicateOf === "string" && obj.duplicateOf.length > 0
				? obj.duplicateOf
				: undefined,
	};
}

function parseCuratorOutput(text: string): CurateOp[] {
	const parsed = parseJson(text, "curator");
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
}

function parseJson(text: string, who: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`memrez ${who} returned non-JSON output`);
	}
}
