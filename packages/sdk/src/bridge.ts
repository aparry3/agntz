import {
	createManifestExecutionContext,
	narrowNamespaceGrants,
	normalizeNamespaceGrants,
} from "@agntz/core";
import type {
	ClientToolDispatcher,
	Reply,
	RunRegistry,
	Runner,
	SpanEmitter,
	ToolContext,
	ToolDefinition,
} from "@agntz/core";
import type { AgentManifest, ExecutionContext } from "@agntz/core/manifest";

export interface CreateExecutionContextOptions {
	spanEmitter?: SpanEmitter;
	sessionId?: string;
	context?: string[];
	signal?: AbortSignal;
	clientToolDispatcher?: ClientToolDispatcher;
	/**
	 * When wired, each `invokeLLM` step runs through this registry as a CHILD
	 * Run of `parentRunId`, so its lifecycle events flow to the root's
	 * multiplexed feed (`runs.stream`). Omitted for plain synchronous runs.
	 */
	runRegistry?: RunRegistry;
	/** Root Run id — inner LLM steps attach to it as children. */
	parentRunId?: string;
	/** Tenant id threaded onto child Runs (single-operator in embedded use). */
	userId?: string;
	/** Owner id attached to trace spans. */
	ownerId?: string;
	/**
	 * Local-tool implementations registered with `agntz({ tools: ... })`.
	 * Used by `invokeTool` to dispatch `kind: local` pipeline tool steps
	 * without round-tripping through the LLM-only tool registry.
	 */
	localTools?: Map<string, ToolDefinition>;
	/**
	 * Collects intermediate `reply` tool messages emitted by LLM sub-steps
	 * inside a manifest pipeline. The top-level `.agents.run` aggregates
	 * these onto the returned `RunResult.replies`.
	 */
	replyCollector?: Reply[];
}

/**
 * Build the `ExecutionContext` the manifest executor needs, for single-tenant
 * embedded use. A thin wrapper over `@agntz/core`'s shared
 * `createManifestExecutionContext`; the only embedded-specific seams are:
 *
 *  - `resolveAgent` reads from the in-memory loaded-manifests map
 *  - local tools dispatch through the `agntz({ tools })` map (strict: an
 *    unregistered `kind: local` step throws), with grant-narrowing ToolContexts
 *  - eager local-tool validation + skill rejection (no in-process SkillStore)
 *  - the default temp-agent cleanup (`runner.deregisterAgent`) is correct here
 */
export function createExecutionContext(
	runner: Runner,
	manifests: ReadonlyMap<string, AgentManifest>,
	localToolNames: Set<string>,
	opts: CreateExecutionContextOptions = {},
): ExecutionContext {
	const context = normalizeNamespaceGrants(opts.context);
	return createManifestExecutionContext(runner, {
		resolveAgent: async (id: string) => {
			const manifest = manifests.get(id);
			if (!manifest)
				throw new Error(`Agent "${id}" not loaded from agents directory`);
			return manifest;
		},
		manifestToAgent: { localToolNames, rejectSkills: true },
		localTools: opts.localTools,
		toolContext: (toolName) => makeDirectToolContext(runner, toolName, context),
		spanEmitter: opts.spanEmitter,
		sessionId: opts.sessionId,
		context,
		signal: opts.signal,
		clientToolDispatcher: opts.clientToolDispatcher,
		runRegistry: opts.runRegistry,
		parentRunId: opts.parentRunId,
		userId: opts.userId,
		ownerId: opts.ownerId,
		replyCollector: opts.replyCollector,
	});
}

function makeDirectToolContext(
	runner: Runner,
	agentId: string,
	context: string[],
): ToolContext {
	return {
		agentId,
		context,
		invocationId: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
		invoke: (id, input, options) =>
			runner.invoke(id, input, {
				...options,
				context: narrowNamespaceGrants(context, options?.context),
			}),
	};
}
