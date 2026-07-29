import { StructuredOutputError } from "./errors.js";
import { buildHttpToolDefinition } from "./http-tool.js";
import {
	type ManifestToAgentOptions,
	manifestToAgentDefinition,
} from "./manifest-to-agent.js";
import type {
	AgentManifest,
	AgentState,
	ExecutionContext,
	ImageAgentManifest,
	LLMAgentManifest,
	ToolCallConfig,
	TranscriptionAgentManifest,
} from "./manifest/index.js";
import {
	ManifestSchemaError,
	assertManifestSchemaValue,
} from "./manifest/schema.js";
import type { Runner } from "./runner.js";
import type { SpanEmitter } from "./telemetry.js";
import type {
	ContentBlock,
	Reply,
	RetentionPolicy,
	RunRegistry,
	ToolContext,
	ToolDefinition,
} from "./types.js";
import { isContentBlockArray } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════
// Manifest → runner bridge (shared).
//
// `createManifestExecutionContext` builds the `ExecutionContext` the manifest
// executor needs to dispatch every agent kind onto the core `Runner`. It is the
// single implementation behind both hosts: the embedded SDK and the hosted
// worker each keep a thin `createExecutionContext` wrapper that supplies only
// the environment-specific strategies below and delegates the shared
// invokeLLM/invokeTool mechanics here.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Optional lifecycle hooks for host-specific observability. The hosted worker
 * supplies console-formatting hooks (its `[llm]`/`[tool]` breadcrumbs); the
 * embedded SDK omits them and stays silent. Injecting hooks keeps `console.*`
 * out of core.
 */
export interface ManifestBridgeHooks {
	onLLMStart?(info: {
		manifest: LLMAgentManifest;
		renderedInstruction: string;
	}): void;
	onLLMDone?(info: {
		manifest: LLMAgentManifest;
		output: string;
		durationMs: number;
		parsed: boolean;
		/** The returned value: parsed object when `parsed`, else the raw string. */
		value: unknown;
	}): void;
	onLLMError?(info: {
		manifest: LLMAgentManifest;
		error: unknown;
		durationMs: number;
		renderedPrompt: string | undefined;
		state: AgentState;
	}): void;
	onToolStart?(info: { config: ToolCallConfig }): void;
	onToolDone?(info: { config: ToolCallConfig; durationMs: number }): void;
	onToolError?(info: {
		config: ToolCallConfig;
		error: unknown;
		durationMs: number;
	}): void;
}

export interface ManifestExecutionContextOptions {
	// ── environment strategies (the genuine divergence between hosts) ──
	/**
	 * Resolve an agent id to its manifest. Embedded: in-memory map lookup;
	 * hosted: `runner.resolveAgentRef` + parse from the stored definition.
	 */
	resolveAgent: (id: string) => Promise<AgentManifest>;
	/**
	 * Options forwarded to `manifestToAgentDefinition` for each LLM step. The
	 * embedded host passes `{ localToolNames, rejectSkills: true }`; the worker
	 * passes `{}` (local refs pass through, skills resolve downstream).
	 * `systemPrompt` is always overridden with the executor's rendered
	 * instruction.
	 */
	manifestToAgent?: ManifestToAgentOptions;
	/**
	 * Remove the temporary per-step agent. Defaults to `runner.deregisterAgent`
	 * (in-memory); the worker overrides with its store-backed delete.
	 */
	cleanupTempAgent?: (runner: Runner, tempId: string) => void | Promise<void>;
	/**
	 * Runs before each LLM step. The worker pre-registers `spawnable` ref
	 * children here so a later `spawn_agent` call resolves; embedded is a no-op.
	 */
	beforeLLMInvoke?: (manifest: LLMAgentManifest) => void | Promise<void>;
	/**
	 * In-process local tools (embedded `agntz({ tools })`). When a `local`
	 * pipeline-tool step names one, it is dispatched here; otherwise the step
	 * falls back to the runner's tool registry (the worker's path).
	 */
	localTools?: Map<string, ToolDefinition>;
	/**
	 * Builds the `ToolContext` handed to a dispatched local (or http) tool.
	 * Required when `localTools` is set.
	 */
	toolContext?: (toolName: string) => ToolContext;
	/** Optional host observability hooks (worker logging). */
	hooks?: ManifestBridgeHooks;

	// ── per-request runtime values (identical semantics across hosts) ──
	runRegistry?: RunRegistry;
	parentRunId?: string;
	userId?: string;
	sessionId?: string;
	context?: string[];
	spanEmitter?: SpanEmitter;
	ownerId?: string;
	/** Accumulates intermediate `reply` messages emitted by LLM sub-steps. */
	replyCollector?: Reply[];
	/** Cancellation, threaded into `runner.invoke`. */
	signal?: AbortSignal;
	/** Exact ordered rich content for the selected/root LLM manifest. */
	content?: ContentBlock[];
	/** Original artifact-reference blocks used for persistence, never decoded bytes. */
	persistenceContent?: ContentBlock[];
	/** Restrict rich content to this manifest id so pipeline children do not reuse it. */
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
 * Unique throwaway id for the per-step temp agent. A monotonic counter plus a
 * timestamp keeps concurrent pipeline steps from colliding in the runner's
 * registry without reaching for `Math.random`.
 */
let tempCounter = 0;
function makeTempId(agentId: string): string {
	tempCounter = (tempCounter + 1) % Number.MAX_SAFE_INTEGER;
	return `__manifest_step_${agentId}_${Date.now().toString(36)}_${tempCounter.toString(36)}`;
}

/**
 * Build a manifest `ExecutionContext` over a core `Runner`. See module header.
 */
export function createManifestExecutionContext(
	runner: Runner,
	opts: ManifestExecutionContextOptions,
): ExecutionContext {
	const cleanup =
		opts.cleanupTempAgent ??
		((r: Runner, id: string) => {
			r.deregisterAgent(id);
		});

	return {
		spanEmitter: opts.spanEmitter,
		ownerId: opts.ownerId,
		resolveAgent: opts.resolveAgent,
		invokeTranscription: opts.invokeTranscription
			? (manifest, state) =>
					opts.invokeTranscription?.(
						manifest,
						state,
						opts.content,
					) as Promise<unknown>
			: undefined,
		invokeImage: opts.invokeImage
			? (manifest, state) =>
					opts.invokeImage?.(manifest, state, opts.content) as Promise<unknown>
			: undefined,

		invokeLLM: async (
			manifest: LLMAgentManifest,
			renderedInstruction: string,
			renderedPrompt: string | undefined,
			state: AgentState,
		) => {
			await opts.beforeLLMInvoke?.(manifest);

			// The executor has already rendered the instruction with full state.
			// core wants a static systemPrompt, so synthesize a temp agent with the
			// rendered text baked in, invoke it, then deregister.
			const def = manifestToAgentDefinition(manifest, {
				...opts.manifestToAgent,
				systemPrompt: renderedInstruction,
			});
			def.userPromptTemplate = undefined; // rendered user message is passed directly
			const tempId = makeTempId(manifest.id);
			def.id = tempId;
			runner.registerAgent(def);

			opts.hooks?.onLLMStart?.({ manifest, renderedInstruction });
			const startedAt = Date.now();
			try {
				const richContent =
					opts.content &&
					(!opts.contentAgentId || opts.contentAgentId === manifest.id)
						? opts.content
						: isContentBlockArray(state.userQuery)
							? state.userQuery
							: undefined;
				const userInput: string | ContentBlock[] = richContent
					? renderedPrompt
						? [{ type: "text", text: renderedPrompt }, ...richContent]
						: richContent
					: (renderedPrompt ??
						(state.userQuery != null
							? String(state.userQuery)
							: JSON.stringify(state)));
				const persistenceContent =
					opts.persistenceContent &&
					(!opts.contentAgentId || opts.contentAgentId === manifest.id)
						? opts.persistenceContent
						: undefined;
				const persistenceInput: string | ContentBlock[] | undefined =
					persistenceContent
						? renderedPrompt
							? [{ type: "text", text: renderedPrompt }, ...persistenceContent]
							: persistenceContent
						: undefined;

				const result = await runner.invoke(tempId, userInput, {
					...(opts.runRegistry
						? { runRegistry: opts.runRegistry, parentRunId: opts.parentRunId }
						: {}),
					...(opts.userId ? { userId: opts.userId } : {}),
					...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
					...(opts.context ? { context: opts.context } : {}),
					...(opts.spanEmitter ? { spanEmitter: opts.spanEmitter } : {}),
					...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
					...(opts.signal ? { signal: opts.signal } : {}),
					...(opts.retention ? { retention: opts.retention } : {}),
					...(persistenceInput ? { _persistenceInput: persistenceInput } : {}),
				});

				if (opts.replyCollector && result.replies?.length) {
					opts.replyCollector.push(...result.replies);
				}

				// Structured-output runs must never degrade to unvalidated raw text.
				let parsed = false;
				let value: unknown = result.output;
				if (manifest.outputSchema) {
					try {
						value = JSON.parse(result.output);
						assertManifestSchemaValue(
							manifest.outputSchema,
							value,
							"Structured model output",
						);
						parsed = true;
					} catch (error) {
						const details =
							error instanceof ManifestSchemaError
								? error.issues.map(
										(issue) => `${issue.path || "/"}: ${issue.message}`,
									)
								: [];
						throw new StructuredOutputError(
							"Model returned output that does not match the manifest outputSchema.",
							details,
							error as Error,
						);
					}
				}

				opts.hooks?.onLLMDone?.({
					manifest,
					output: result.output,
					durationMs: Date.now() - startedAt,
					parsed,
					value,
				});
				return value;
			} catch (error) {
				opts.hooks?.onLLMError?.({
					manifest,
					error,
					durationMs: Date.now() - startedAt,
					renderedPrompt,
					state,
				});
				throw error;
			} finally {
				await cleanup(runner, tempId);
			}
		},

		invokeTool: async (config: ToolCallConfig, state: AgentState) => {
			opts.hooks?.onToolStart?.({ config });
			const startedAt = Date.now();
			try {
				const out = await dispatchTool(runner, config, state, opts);
				opts.hooks?.onToolDone?.({
					config,
					durationMs: Date.now() - startedAt,
				});
				return out;
			} catch (error) {
				opts.hooks?.onToolError?.({
					config,
					error,
					durationMs: Date.now() - startedAt,
				});
				throw error;
			}
		},
	};
}

/**
 * Dispatch a single pipeline tool step. The `http` branch builds the tool from
 * the FULL config — including `body`/`body_type`/`auth` — and passes the
 * runner's token resolver/cache, so authed and bodied http steps work in every
 * host (the worker previously dropped these).
 */
async function dispatchTool(
	runner: Runner,
	config: ToolCallConfig,
	state: AgentState,
	opts: ManifestExecutionContextOptions,
): Promise<unknown> {
	switch (config.kind) {
		case "local": {
			// Embedded hosts pass `localTools` and expect every `local` step to name
			// a registered handler (strict). Hosts without an in-process map (the
			// worker) route `local` steps through the runner's tool registry.
			if (opts.localTools) {
				const local = opts.localTools.get(config.name);
				if (!local) {
					throw new Error(
						`Pipeline tool step references local tool '${config.name}' but no handler was registered.`,
					);
				}
				const ctx = opts.toolContext?.(config.name);
				if (!ctx) {
					throw new Error(
						`Local tool '${config.name}' dispatched without a ToolContext; pass \`toolContext\` alongside \`localTools\`.`,
					);
				}
				return local.execute(config.params ?? {}, ctx);
			}
			return runner.tools.execute(config.name, config.params ?? {});
		}
		case "http": {
			if (!config.url)
				throw new Error("HTTP pipeline tool config missing 'url'");
			const tool = buildHttpToolDefinition(
				{
					kind: "http",
					name: config.name,
					url: config.url,
					method: config.method,
					description: config.description,
					params: config.params,
					headers: config.headers,
					body_type: config.body_type,
					body: config.body,
					auth: config.auth,
				},
				state,
				{ tokenResolver: runner.tokenResolver, tokenCache: runner.tokenCache },
			);
			const ctx = opts.toolContext?.(`http__${config.name}`);
			return (
				tool.execute as (a: unknown, c?: ToolContext) => Promise<unknown>
			)({}, ctx);
		}
		case "mcp": {
			const toolName = config.server
				? `${config.server}:${config.name}`
				: config.name;
			return runner.tools.execute(toolName, config.params ?? {});
		}
	}
}
