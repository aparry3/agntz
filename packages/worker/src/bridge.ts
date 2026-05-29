import type {
	AgentDefinition,
	AgentRef as CoreAgentRef,
	Reply,
	RunRegistry,
	Runner,
} from "@agntz/core";
import { buildHttpToolDefinition } from "@agntz/core";
import type {
	AgentManifest,
	AgentRef,
	AgentState,
	ExecutionContext,
	LLMAgentManifest,
	ToolCallConfig,
} from "@agntz/manifest";
import { parseManifest } from "@agntz/manifest";

export interface CreateExecutionContextOptions {
	/**
	 * Per-request RunRegistry. When provided, LLM invocations receive it
	 * via `InvokeOptions.runRegistry` so that any `spawnable` agents can
	 * synthesize the `spawn_agent` / `check_agents` tools and create child
	 * Runs. Without a registry, spawn tools are not registered and any
	 * `spawn_agent` call would fail at runtime.
	 */
	runRegistry?: RunRegistry;

	/** Per-request span emitter. Forwarded to runner.invoke so the executor
	 *  and runner share the same trace stack. */
	spanEmitter?: import("@agntz/core").SpanEmitter;

	/** Tenant scoping. Threaded into ExecutionContext and span metadata. */
	ownerId?: string;

	/**
	 * When set, each `invokeLLM` call threads this as `parentRunId` on the
	 * inner `runner.invoke()`. The resulting Run becomes a child of the
	 * caller-provided parent, so subscribing to the parent's subtree feed
	 * also surfaces these LLM-step Runs (and their spawned children).
	 *
	 * Used by `POST /runs`, where the outer Run represents the whole
	 * manifest execution and the inner LLM steps should appear under it.
	 */
	parentRunId?: string;
	/** Optional userId for ToolContext + Run scoping. */
	userId?: string;
	/** Optional sessionId for ToolContext + Run scoping. */
	sessionId?: string;
	/** Runtime namespace capability grants for resource providers. */
	context?: string[];
	/**
	 * Per-request reply accumulator. Each `runner.invoke()` call inside
	 * `invokeLLM` appends its `result.replies` here so the worker route can
	 * surface the union back to the caller. Optional — routes that don't
	 * care about replies (e.g. `/runs` async creation) can omit it.
	 */
	replyCollector?: Reply[];
}

/**
 * Create an ExecutionContext that bridges the manifest engine to the core Runner.
 *
 * This is how YAML-defined agents execute: the manifest engine handles orchestration
 * (pipelines, state, conditions), and delegates actual LLM/tool calls to the Runner.
 */
export function createExecutionContext(
	runner: Runner,
	options: CreateExecutionContextOptions = {},
): ExecutionContext {
	const {
		runRegistry,
		spanEmitter,
		ownerId,
		parentRunId,
		userId,
		sessionId,
		replyCollector,
		context,
	} = options;
	return {
		spanEmitter,
		ownerId,
		resolveAgent: async (id: string) => {
			// `id` may be a plain agent id or carry an `@<version|latest>` suffix.
			// `resolveAgentRef` parses and dispatches; returns null on any failure.
			const agentDef = await runner.resolveAgentRef(id);
			if (!agentDef) {
				throw new Error(`Agent "${id}" not found`);
			}
			// Agent definitions stored in the DB may have a `manifest` field (YAML string)
			// or may already be a parsed manifest object stored as metadata
			const manifest = resolveManifestFromAgent(
				agentDef as unknown as Record<string, unknown>,
			);
			return manifest;
		},

		invokeLLM: async (
			manifest: LLMAgentManifest,
			renderedInstruction: string,
			renderedPrompt: string | undefined,
			state: AgentState,
		) => {
			// For ref-kind spawnable children, the agent store only holds a placeholder
			// AgentDefinition (real config lives in metadata.manifest). Pre-register
			// each ref child as a real AgentDefinition under its actual id so that
			// when the LLM calls spawn_agent, runner.invoke(child_id) resolves to a
			// working definition. Inline children are translated below and registered
			// by the runner's own resolveSpawnable path.
			if (manifest.spawnable && runRegistry) {
				await preregisterSpawnableRefs(runner, manifest.spawnable);
			}

			// Build a temporary agent definition for the core runner. The manifest
			// layer has already rendered the prompt with full state; we pass that
			// rendered text in as the user input directly, so the AgentDefinition's
			// `userPromptTemplate` must be cleared to prevent core from re-wrapping
			// (or sending the unrendered template literally).
			const agentDef = manifestToAgentDefinition(manifest, renderedInstruction);
			agentDef.userPromptTemplate = undefined;

			// Register it temporarily (or use inline invoke)
			const tempId = `__temp_${manifest.id}_${Date.now()}`;
			agentDef.id = tempId;
			runner.registerAgent(agentDef as AgentDefinition);

			const hasSchema = Boolean(manifest.outputSchema);
			const start = Date.now();
			console.log(
				`[llm] ${manifest.id} start ` +
					`model=${manifest.model.provider}/${manifest.model.name} ` +
					`instr=${renderedInstruction.length}ch schema=${hasSchema} ` +
					`spawnable=${manifest.spawnable?.length ?? 0}`,
			);

			try {
				// Build user input. If the manifest defines a `prompt` template, the
				// executor has already rendered it with full state — use it verbatim
				// as the user message. Otherwise fall back to the raw user query.
				const userInput =
					renderedPrompt ??
					(state.userQuery ? String(state.userQuery) : JSON.stringify(state));

				const result = await runner.invoke(tempId, userInput, {
					...(runRegistry ? { runRegistry, parentRunId } : {}),
					...(userId ? { userId } : {}),
					...(sessionId ? { sessionId } : {}),
					...(context ? { context } : {}),
					...(spanEmitter ? { spanEmitter } : {}),
					...(ownerId ? { ownerId } : {}),
				});
				const duration = Date.now() - start;

				// Bubble per-invoke replies up to the route layer. Replies are
				// already persisted to the session by the runner; this just
				// surfaces them on the wire response.
				if (replyCollector && result.replies && result.replies.length > 0) {
					replyCollector.push(...result.replies);
				}

				// If outputSchema is defined, try to parse structured output
				if (hasSchema) {
					try {
						const parsed = JSON.parse(result.output);
						console.log(
							`[llm] ${manifest.id} done ${duration}ms ` +
								`out=${result.output.length}ch parsed keys=[${Object.keys(parsed).join(",")}]`,
						);
						return parsed;
					} catch (err) {
						console.warn(
							`[llm] ${manifest.id} done ${duration}ms ` +
								`out=${result.output.length}ch PARSE FAILED (${(err as Error).message}) — returning raw text`,
						);
						return result.output;
					}
				}

				console.log(
					`[llm] ${manifest.id} done ${duration}ms out=${result.output.length}ch`,
				);
				return result.output;
			} catch (err) {
				const duration = Date.now() - start;
				const e = err as Error & { cause?: unknown };
				console.error(
					`[llm] ${manifest.id} failed ${duration}ms: ${e?.message}\nuserInput.len=${(renderedPrompt ?? "").length} preview=${JSON.stringify((renderedPrompt ?? (state.userQuery ? String(state.userQuery) : "")).slice(0, 200))}${e?.cause ? `\ncause=${JSON.stringify(e.cause)?.slice(0, 400)}` : ""}${e?.stack ? `\nstack=${e.stack}` : ""}`,
				);
				throw err;
			} finally {
				// Clean up temp agent
				await runner.agents.deleteAgent(tempId).catch(() => {});
			}
		},

		invokeTool: async (config: ToolCallConfig, state: AgentState) => {
			// HTTP tool steps don't go through the runner's tool registry — build
			// the definition inline from the config and execute it against state.
			// params/headers are interpolated against state by buildHttpToolDefinition
			// (params already pre-resolved by executeTool — re-interpolation is a
			// no-op on plain strings).
			if (config.kind === "http") {
				if (!config.url) throw new Error("HTTP tool config missing url");
				const start = Date.now();
				const label = `http__${config.name}`;
				console.log(`[tool] ${label} start url=${config.url}`);
				try {
					const tool = buildHttpToolDefinition(
						{
							kind: "http",
							name: config.name,
							url: config.url,
							method: config.method,
							description: config.description,
							params: config.params,
							headers: config.headers,
						},
						state,
					);
					// The HTTP tool's execute ignores ToolContext — pipeline tool steps
					// have no surrounding LLM invocation to supply one.
					const result = await (
						tool.execute as (args: unknown) => Promise<unknown>
					)({});
					console.log(`[tool] ${label} done ${Date.now() - start}ms`);
					return result;
				} catch (err) {
					console.error(
						`[tool] ${label} failed ${Date.now() - start}ms: ${(err as Error).message}`,
					);
					throw err;
				}
			}

			// Resolve the tool name (MCP tools are namespaced as "serverName:toolName")
			const toolName =
				config.kind === "mcp" && config.server
					? `${config.server}:${config.name}`
					: config.name;

			// The params are already resolved from state by the tool executor
			const input = config.params ?? {};

			const start = Date.now();
			console.log(
				`[tool] ${toolName} start params=${JSON.stringify(input).slice(0, 200)}`,
			);
			try {
				const result = await runner.tools.execute(toolName, input);
				console.log(`[tool] ${toolName} done ${Date.now() - start}ms`);
				return result;
			} catch (err) {
				console.error(
					`[tool] ${toolName} failed ${Date.now() - start}ms: ${(err as Error).message}`,
				);
				throw err;
			}
		},
	};
}

/**
 * Convert a stored AgentDefinition into an AgentManifest.
 * The agent's metadata.manifest field holds the YAML source.
 */
function resolveManifestFromAgent(
	agentDef: Record<string, unknown>,
): AgentManifest {
	// If metadata contains the raw YAML manifest
	const metadata = agentDef.metadata as Record<string, unknown> | undefined;
	if (metadata?.manifest && typeof metadata.manifest === "string") {
		return parseManifest(metadata.manifest);
	}

	// If metadata contains a pre-parsed manifest object
	if (metadata?.parsedManifest) {
		return metadata.parsedManifest as AgentManifest;
	}

	// Fallback: try to construct from the agent definition itself
	throw new Error(
		`Agent "${agentDef.id}" does not have a manifest. Store agents with metadata.manifest (YAML string).`,
	);
}

/**
 * Convert a LLMAgentManifest into a core AgentDefinition for the Runner.
 *
 * `userPromptTemplate` is set from `manifest.prompt` when present so that
 * spawnable children (which bypass `executeLLM` and go directly through the
 * core runner) get template behavior via core's `{{input}}` substitution. For
 * top-level invocations (called from `invokeLLM`), the manifest layer has
 * already rendered the prompt with full state — the caller passes the rendered
 * string as the user input directly, so `userPromptTemplate` is a no-op there
 * (no `{{input}}` markers remain in rendered text).
 */
function manifestToAgentDefinition(
	manifest: LLMAgentManifest,
	renderedInstruction: string,
) {
	return {
		id: manifest.id,
		name: manifest.name ?? manifest.id,
		systemPrompt: renderedInstruction,
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
		tools: manifest.tools ? manifestToolsToToolRefs(manifest.tools) : undefined,
		spawnable: manifest.spawnable
			? manifestSpawnableToCore(manifest.spawnable)
			: undefined,
		reply: manifest.reply,
	};
}

/**
 * Translate manifest-layer AgentRef[] (with inline LLMAgentManifest) into the
 * core AgentRef[] shape (with inline AgentDefinition). Inline children are
 * registered by the runner's own resolveSpawnable path; we just give them the
 * shape it expects. Ref children pass through unchanged.
 */
function manifestSpawnableToCore(spawnable: AgentRef[]): CoreAgentRef[] {
	return spawnable.map((ref) => {
		if (ref.kind === "ref") {
			return ref.version
				? { kind: "ref", agentId: ref.agentId, version: ref.version }
				: { kind: "ref", agentId: ref.agentId };
		}
		// Inline LLM children: validator forbids template variables in the
		// instruction, so we use it verbatim as the systemPrompt.
		return {
			kind: "inline",
			definition: manifestToAgentDefinition(
				ref.definition,
				ref.definition.instruction,
			) as AgentDefinition,
		};
	});
}

/**
 * Pre-register each ref-kind spawnable child as a working AgentDefinition
 * under its real id, sourcing config from the child's stored YAML manifest.
 * Required because the app stores agents with a placeholder AgentDefinition
 * (real config lives in metadata.manifest) — the runner's `resolveAgent`
 * would otherwise hand spawn_agent an empty systemPrompt.
 *
 * Children must be LLM-kind manifests with non-templated instructions (the
 * validator enforces this for inline children; ref children whose stored
 * manifest violates it are skipped here with a console warning rather than
 * surfaced to the parent invocation).
 */
async function preregisterSpawnableRefs(
	runner: Runner,
	spawnable: AgentRef[],
): Promise<void> {
	for (const ref of spawnable) {
		if (ref.kind !== "ref") continue;
		// Honor `@version` pinning so the pre-registered child reflects the
		// manifest author's pin, not whatever happens to be activated today.
		const lookup = ref.version ? `${ref.agentId}@${ref.version}` : ref.agentId;
		const stored = await runner.resolveAgentRef(lookup);
		if (!stored) {
			console.warn(`[spawn] skip ref '${lookup}': not in agent store`);
			continue;
		}
		let childManifest: AgentManifest;
		try {
			childManifest = resolveManifestFromAgent(
				stored as unknown as Record<string, unknown>,
			);
		} catch (err) {
			console.warn(
				`[spawn] skip ref '${ref.agentId}': ${(err as Error).message}`,
			);
			continue;
		}
		if (childManifest.kind !== "llm") {
			console.warn(
				`[spawn] skip ref '${ref.agentId}': only llm-kind children supported (got ${childManifest.kind})`,
			);
			continue;
		}
		if (/\{\{[^}]+\}\}/.test(childManifest.instruction)) {
			console.warn(
				`[spawn] skip ref '${ref.agentId}': instruction contains template variables; spawn callbacks pre-register children with static systemPrompts`,
			);
			continue;
		}
		const def = manifestToAgentDefinition(
			childManifest,
			childManifest.instruction,
		) as AgentDefinition;
		runner.registerAgent(def);
	}
}

/**
 * Convert the flat manifest outputSchema to a proper JSON Schema.
 */
function manifestSchemaToJsonSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [key, value] of Object.entries(schema)) {
		if (typeof value === "string") {
			properties[key] = { type: value };
		} else {
			properties[key] = enforceStrictObject(value);
		}
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
 * OpenAI strict structured output requires `additionalProperties: false` on every
 * nested object schema. Walk the schema and enforce it.
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
			for (const [k, v] of Object.entries(props))
				walked[k] = enforceStrictObject(v);
			out.properties = walked;
		}
	}
	if (obj.type === "array" && obj.items) {
		out.items = enforceStrictObject(obj.items);
	}
	return out;
}

/**
 * Convert manifest tool entries to core ToolReference format.
 */
function manifestToolsToToolRefs(tools: LLMAgentManifest["tools"]) {
	if (!tools) return [];

	const refs: Array<Record<string, unknown>> = [];
	for (const entry of tools) {
		switch (entry.kind) {
			case "mcp":
				refs.push({
					type: "mcp",
					server: entry.server,
					tools: entry.tools
						? entry.tools.map((t) => (typeof t === "string" ? t : t.tool))
						: undefined,
					headers: entry.headers,
				});
				break;
			case "local":
				for (const name of entry.tools) {
					refs.push({ type: "inline", name });
				}
				break;
			case "agent":
				refs.push({ type: "agent", agentId: entry.agent });
				break;
			case "http":
				// HTTP entries pass the full entry through to the core runner so
				// `buildHttpToolDefinition` can build the per-invocation
				// `ToolDefinition` with `state.secrets` baked in.
				refs.push({ type: "http", entry });
				break;
		}
	}
	return refs;
}
