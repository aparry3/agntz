import type {
	AgentManifest,
	LLMAgentManifest,
	AgentRef as ManifestAgentRef,
	ManifestToolEntry,
} from "./manifest/index.js";
import type { AgentDefinition, AgentRef, ToolReference } from "./types.js";

/**
 * Options controlling how a manifest is lowered into a core `AgentDefinition`.
 *
 * The conversion itself is shared by every host (the embedded SDK and the
 * hosted worker); these options carry the few environment-specific choices:
 *
 *  - `localToolNames` — embedded hosts pass the set of in-process tool names so a
 *    `kind: "local"` reference to an unregistered name fails at load instead of
 *    at first model call. The worker omits it (local refs pass through).
 *  - `systemPrompt` — hosts that have already rendered the instruction with run
 *    state pass the rendered text here (and clear `userPromptTemplate`). Defaults
 *    to `manifest.instruction`.
 *  - `rejectSkills` — embedded hosts set this (no in-process SkillStore); the
 *    worker leaves it false and resolves skills against its SkillStore downstream.
 */
export interface ManifestToAgentOptions {
	localToolNames?: Set<string>;
	systemPrompt?: string;
	rejectSkills?: boolean;
}

/**
 * Lower a parsed agent manifest into the `AgentDefinition` shape the core runner
 * consumes. Only `llm` agents convert directly — other kinds are orchestrated by
 * the manifest executor, which delegates the leaf LLM/tool calls back here via
 * the host's `ExecutionContext`.
 *
 * Tool kinds handled: local (resolved against `localToolNames` when supplied),
 * http (state-templated, with `{{env.X}}`/`{{secrets.X}}` refs resolved at call
 * time), mcp (lazy URL connection), and agent (subagent invocation by id).
 */
export function manifestToAgentDefinition(
	manifest: AgentManifest,
	opts: ManifestToAgentOptions = {},
): AgentDefinition {
	if (manifest.kind !== "llm") {
		throw new Error(
			`Agent '${manifest.id}' has kind '${manifest.kind}' — only 'llm' agents convert to an AgentDefinition.`,
		);
	}
	return llmManifestToAgentDefinition(manifest, opts);
}

function llmManifestToAgentDefinition(
	manifest: LLMAgentManifest,
	opts: ManifestToAgentOptions,
): AgentDefinition {
	if (opts.rejectSkills && manifest.skills && manifest.skills.length > 0) {
		throw new Error(
			`Agent '${manifest.id}' declares skills — not supported in this context (no SkillStore available).`,
		);
	}

	const tools: ToolReference[] = manifest.tools
		? convertTools(manifest, manifest.tools, opts.localToolNames)
		: [];

	return {
		id: manifest.id,
		name: manifest.name ?? manifest.id,
		description: manifest.description,
		systemPrompt: opts.systemPrompt ?? manifest.instruction,
		userPromptTemplate: manifest.prompt,
		model: {
			provider: manifest.model.provider,
			name: manifest.model.name,
			temperature: manifest.model.temperature,
			maxTokens: manifest.model.maxTokens,
			topP: manifest.model.topP,
		},
		examples: manifest.examples,
		outputSchema: manifest.outputSchema
			? manifestSchemaToJsonSchema(manifest.outputSchema)
			: undefined,
		tools: tools.length > 0 ? tools : undefined,
		spawnable: manifest.spawnable
			? convertSpawnable(manifest.spawnable, opts)
			: undefined,
		reply: manifest.reply,
		resources: manifest.resources,
	};
}

function convertTools(
	manifest: LLMAgentManifest,
	entries: ManifestToolEntry[],
	localToolNames: Set<string> | undefined,
): ToolReference[] {
	const out: ToolReference[] = [];
	for (const entry of entries) {
		switch (entry.kind) {
			case "local":
				for (const name of entry.tools) {
					if (localToolNames && !localToolNames.has(name)) {
						throw new Error(
							`Agent '${manifest.id}' references local tool '${name}' but no handler was registered. Pass it in the \`tools\` map when calling \`agntz()\`.`,
						);
					}
					out.push({ type: "inline", name });
				}
				break;
			case "http":
				out.push({ type: "http", entry });
				break;
			case "mcp":
				out.push({
					type: "mcp",
					server: entry.server,
					tools: entry.tools
						? entry.tools.map((t) => (typeof t === "string" ? t : t.tool))
						: undefined,
					headers: entry.headers,
				});
				break;
			case "agent":
				out.push({ type: "agent", agentId: entry.agent });
				break;
		}
	}
	return out;
}

function convertSpawnable(
	refs: ManifestAgentRef[],
	opts: ManifestToAgentOptions,
): AgentRef[] {
	return refs.map((ref) => {
		if (ref.kind === "ref") {
			return ref.version
				? { kind: "ref", agentId: ref.agentId, version: ref.version }
				: { kind: "ref", agentId: ref.agentId };
		}
		// Inline child — convert recursively. The validator forbids template
		// variables in inline-child instructions, so the child's own instruction
		// is used verbatim as its systemPrompt (the default). Local-tool
		// validation and the skills guard propagate to the child.
		const childDef = llmManifestToAgentDefinition(ref.definition, {
			localToolNames: opts.localToolNames,
			rejectSkills: opts.rejectSkills,
		});
		return { kind: "inline", definition: childDef };
	});
}

/** Convert the flat manifest `outputSchema` shorthand into a JSON Schema. */
function manifestSchemaToJsonSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [key, value] of Object.entries(schema)) {
		properties[key] =
			typeof value === "string" ? { type: value } : enforceStrictObject(value);
		required.push(key);
	}

	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

/**
 * OpenAI strict structured output requires `additionalProperties: false` on
 * every nested object schema. Walk the schema and enforce it.
 */
function enforceStrictObject(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	const obj = value as Record<string, unknown>;
	const out: Record<string, unknown> = { ...obj };

	if (obj.type === "object") {
		if (!("additionalProperties" in out)) out.additionalProperties = false;
		const props = obj.properties as Record<string, unknown> | undefined;
		if (props) {
			const walked: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(props)) {
				walked[key] = enforceStrictObject(child);
			}
			out.properties = walked;
		}
	}

	if (obj.type === "array" && obj.items) {
		out.items = enforceStrictObject(obj.items);
	}

	return out;
}
