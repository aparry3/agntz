import {
	createManifestExecutionContext,
	manifestToAgentDefinition,
} from "@agntz/core";
import type {
	ContentBlock,
	ManifestBridgeHooks,
	Reply,
	RetentionPolicy,
	RunRegistry,
	Runner,
	SpanEmitter,
} from "@agntz/core";
import type {
	AgentManifest,
	AgentRef,
	AgentState,
	ExecutionContext,
	ImageAgentManifest,
	ToolCallConfig,
	TranscriptionAgentManifest,
} from "@agntz/core/manifest";
import { parseManifest } from "@agntz/core/manifest";

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
	spanEmitter?: SpanEmitter;

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
	/** Cancellation propagated from the owning root Run. */
	signal?: AbortSignal;
	/**
	 * Per-request reply accumulator. Each `runner.invoke()` call inside
	 * `invokeLLM` appends its `result.replies` here so the worker route can
	 * surface the union back to the caller. Optional — routes that don't
	 * care about replies (e.g. `/runs` async creation) can omit it.
	 */
	replyCollector?: Reply[];
	content?: ContentBlock[];
	persistenceContent?: ContentBlock[];
	contentAgentId?: string;
	retention?: RetentionPolicy;
	invokeTranscription?: (
		manifest: TranscriptionAgentManifest,
		state: AgentState,
		content: ContentBlock[] | undefined,
	) => Promise<unknown>;
	invokeImage?: (
		manifest: ImageAgentManifest,
		state: AgentState,
		content: ContentBlock[] | undefined,
	) => Promise<unknown>;
}

/**
 * Create an ExecutionContext that bridges the manifest engine to the core Runner.
 *
 * This is how YAML-defined agents execute: the manifest engine handles
 * orchestration (pipelines, state, conditions) and delegates leaf LLM/tool
 * calls to the Runner. A thin wrapper over `@agntz/core`'s shared
 * `createManifestExecutionContext`; the hosted-specific seams are:
 *
 *  - `resolveAgent` resolves stored agents (DB) + parses their YAML manifest
 *  - `spawnable` ref children are pre-registered before each LLM step
 *  - the temp agent is removed via the store-backed `agents.deleteAgent`
 *  - `local`/`mcp` tool steps route through the runner's tool registry
 *  - `[llm]`/`[tool]` console breadcrumbs are emitted via `consoleHooks`
 */
export function createExecutionContext(
	runner: Runner,
	options: CreateExecutionContextOptions = {},
): ExecutionContext {
	return createManifestExecutionContext(runner, {
		resolveAgent: async (id: string) => {
			// `id` may be a plain agent id or carry an `@<version|latest>` suffix.
			// `resolveAgentRef` parses and dispatches; returns null on any failure.
			const agentDef = await runner.resolveAgentRef(id);
			if (!agentDef) {
				throw new Error(`Agent "${id}" not found`);
			}
			// Stored agents carry their manifest as YAML (or a parsed object) under
			// `metadata`; lower it back to an AgentManifest for the executor.
			return resolveManifestFromAgent(
				agentDef as unknown as Record<string, unknown>,
			);
		},
		// For ref-kind spawnable children, the agent store only holds a placeholder
		// AgentDefinition (real config lives in metadata.manifest). Pre-register each
		// ref child under its real id so a later `spawn_agent` call resolves.
		beforeLLMInvoke: async (manifest) => {
			if (manifest.spawnable && options.runRegistry) {
				await preregisterSpawnableRefs(runner, manifest.spawnable);
			}
		},
		// Hosted agents live in the store, so the temp per-step agent is removed
		// there rather than from the in-memory registry.
		cleanupTempAgent: (r, id) => r.agents.deleteAgent(id).catch(() => {}),
		hooks: consoleHooks,
		runRegistry: options.runRegistry,
		spanEmitter: options.spanEmitter,
		ownerId: options.ownerId,
		parentRunId: options.parentRunId,
		userId: options.userId,
		sessionId: options.sessionId,
		context: options.context,
		signal: options.signal,
		replyCollector: options.replyCollector,
		content: options.content,
		persistenceContent: options.persistenceContent,
		contentAgentId: options.contentAgentId,
		retention: options.retention,
		invokeTranscription: options.invokeTranscription,
		invokeImage: options.invokeImage,
	});
}

/** `http__name` / `server:name` / `name` — the label used in `[tool]` logs. */
function toolLabel(config: ToolCallConfig): string {
	if (config.kind === "http") return `http__${config.name}`;
	if (config.kind === "mcp" && config.server)
		return `${config.server}:${config.name}`;
	return config.name;
}

/**
 * Console-formatting hooks that preserve the worker's `[llm]`/`[tool]`
 * breadcrumbs (useful in the hosted logs). Injected into the shared core bridge
 * so `console.*` stays out of `@agntz/core`.
 */
const consoleHooks: ManifestBridgeHooks = {
	onLLMStart({ manifest, renderedInstruction }) {
		console.log(
			`[llm] ${manifest.id} start ` +
				`model=${manifest.model.provider}/${manifest.model.name} ` +
				`instr=${renderedInstruction.length}ch schema=${Boolean(manifest.outputSchema)} ` +
				`spawnable=${manifest.spawnable?.length ?? 0}`,
		);
	},
	onLLMDone({ manifest, output, durationMs, parsed, value }) {
		if (parsed) {
			console.log(
				`[llm] ${manifest.id} done ${durationMs}ms ` +
					`out=${output.length}ch parsed keys=[${Object.keys(value as Record<string, unknown>).join(",")}]`,
			);
		} else if (manifest.outputSchema) {
			console.warn(
				`[llm] ${manifest.id} done ${durationMs}ms ` +
					`out=${output.length}ch PARSE FAILED — returning raw text`,
			);
		} else {
			console.log(
				`[llm] ${manifest.id} done ${durationMs}ms out=${output.length}ch`,
			);
		}
	},
	onLLMError({ manifest, error, durationMs, renderedPrompt, state }) {
		const e = error as Error & { cause?: unknown };
		const preview = JSON.stringify(
			(
				renderedPrompt ?? (state.userQuery ? String(state.userQuery) : "")
			).slice(0, 200),
		);
		console.error(
			`[llm] ${manifest.id} failed ${durationMs}ms: ${e?.message}\n` +
				`userInput.len=${(renderedPrompt ?? "").length} preview=${preview}` +
				`${e?.cause ? `\ncause=${JSON.stringify(e.cause)?.slice(0, 400)}` : ""}` +
				`${e?.stack ? `\nstack=${e.stack}` : ""}`,
		);
	},
	onToolStart({ config }) {
		if (config.kind === "http") {
			console.log(`[tool] http__${config.name} start url=${config.url}`);
			return;
		}
		console.log(
			`[tool] ${toolLabel(config)} start params=${JSON.stringify(config.params ?? {}).slice(0, 200)}`,
		);
	},
	onToolDone({ config, durationMs }) {
		console.log(`[tool] ${toolLabel(config)} done ${durationMs}ms`);
	},
	onToolError({ config, error, durationMs }) {
		console.error(
			`[tool] ${toolLabel(config)} failed ${durationMs}ms: ${(error as Error).message}`,
		);
	},
};

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
		const def = manifestToAgentDefinition(childManifest, {});
		runner.registerAgent(def);
	}
}
