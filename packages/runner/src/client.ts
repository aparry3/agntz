import { createRunner } from "@agntz/core";
import type {
  Runner,
  InvokeResult,
  ModelProvider,
  StreamEvent as CoreStreamEvent,
} from "@agntz/core";
import type { AgentManifest } from "@agntz/manifest";
import type { RunInput, RunResult, StreamEvent } from "@agntz/sdk";
import { loadManifestsFromDir } from "./loader.js";
import { manifestToAgentDefinition } from "./manifest-to-agent.js";
import { toolMapToDefinitions, type LocalToolMap } from "./tools.js";

export interface AgntzLocalOptions {
  /**
   * Directory of `.yaml`/`.yml` agent manifests. Scanned recursively at
   * init; the runner is then frozen — edits on disk require a process
   * restart to pick up.
   */
  agents: string;
  /**
   * Map of local tool names → handlers. Handlers are wired into the runner
   * once at init; the YAML `kind: local` entries reference these by name.
   * A YAML reference to a name not present here fails at load time.
   */
  tools?: LocalToolMap;
  /**
   * Resolves `{{env.<NAME>}}` references in HTTP tool params/headers.
   * Defaults to `(n) => process.env[n]` — set to a stricter function (or
   * `() => undefined`) to lock down which env vars manifests can reach.
   */
  envProvider?: (name: string) => string | undefined;
  /**
   * Custom model provider. By default the runner uses the AI SDK provider
   * which reads API keys from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   * etc.). Pass a custom provider to mock during tests or to point at a
   * different model backend.
   */
  modelProvider?: ModelProvider;
}

/**
 * The minimal client surface for embedded agent execution. Mirrors the
 * hosted `AgntzClient` from `@agntz/sdk` so user code can graduate to the
 * remote API by swapping a single import line.
 */
export interface LocalClient {
  readonly agents: LocalAgentsResource;
  /** Map of loaded agent manifests keyed by id. Useful for introspection. */
  readonly manifests: ReadonlyMap<string, AgentManifest>;
  /** Underlying core runner. Escape hatch for power users. */
  readonly _runner: Runner;
}

export interface LocalAgentsResource {
  run(input: RunInput): Promise<RunResult>;
  stream(input: RunInput): AsyncGenerator<StreamEvent, void, void>;
}

/**
 * Construct an embedded agntz client. Reads YAML manifests from disk,
 * registers them with an in-process core runner, and exposes the
 * SDK-shaped surface for invocation.
 *
 * Throws synchronously-then-asynchronously: validation errors surface
 * when `agntz()` resolves; runtime errors (missing env var, model auth)
 * surface at `agents.run`/`agents.stream`.
 */
export async function agntz(opts: AgntzLocalOptions): Promise<LocalClient> {
  const manifests = await loadManifestsFromDir(opts.agents);
  const localToolNames = new Set(Object.keys(opts.tools ?? {}));
  const toolDefs = opts.tools ? toolMapToDefinitions(opts.tools) : [];

  const envProvider = opts.envProvider ?? ((name: string) => process.env[name]);

  const runner = createRunner({
    tools: toolDefs,
    envProvider,
    modelProvider: opts.modelProvider,
  });

  for (const manifest of manifests.values()) {
    const def = manifestToAgentDefinition(manifest, localToolNames);
    runner.registerAgent(def);
  }

  return new LocalClientImpl(runner, manifests);
}

class LocalClientImpl implements LocalClient {
  readonly agents: LocalAgentsResource;
  constructor(
    readonly _runner: Runner,
    readonly manifests: ReadonlyMap<string, AgentManifest>,
  ) {
    this.agents = new AgentsResourceImpl(_runner);
  }
}

class AgentsResourceImpl implements LocalAgentsResource {
  constructor(private readonly runner: Runner) {}

  async run(input: RunInput): Promise<RunResult> {
    const result = await this.runner.invoke(input.agentId, normalizeInput(input.input), {
      sessionId: input.sessionId,
      signal: input.signal,
    });
    return invokeResultToRunResult(result);
  }

  async *stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
    const iter = this.runner.stream(input.agentId, normalizeInput(input.input), {
      sessionId: input.sessionId,
      signal: input.signal,
    });
    if (input.sessionId) {
      yield { type: "start", agentId: input.agentId, kind: "llm", sessionId: input.sessionId };
    }
    try {
      for await (const event of iter) {
        const mapped = mapStreamEvent(event, input.agentId);
        if (mapped) yield mapped;
      }
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
  }
}

function normalizeInput(input: RunInput["input"]): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  // Non-string inputs (multimodal blocks, JSON objects) — runner accepts
  // ContentBlock[] directly. Pass through as a plain string when possible,
  // otherwise JSON-stringify so the model gets something it can read.
  return JSON.stringify(input);
}

function invokeResultToRunResult(result: InvokeResult): RunResult {
  return {
    output: result.output,
    state: {
      invocationId: result.invocationId,
      usage: result.usage,
      duration: result.duration,
      model: result.model,
      toolCalls: result.toolCalls,
    },
    sessionId: result.sessionId,
    replies: result.replies,
  };
}

/**
 * Translate the core's per-step streaming events into the SDK's higher-
 * level `start | complete | reply | error` union. The core emits low-
 * level events (text-delta, tool-call-*, step-complete) which we drop
 * for SDK parity; `done` carries the final InvokeResult which becomes
 * a `complete` event. Errors are caught in the caller and emitted as a
 * separate `error` event before re-throwing.
 */
function mapStreamEvent(event: CoreStreamEvent, _agentId: string): StreamEvent | null {
  switch (event.type) {
    case "done":
      return {
        type: "complete",
        output: event.result.output,
        state: {
          invocationId: event.result.invocationId,
          usage: event.result.usage,
          duration: event.result.duration,
          model: event.result.model,
          toolCalls: event.result.toolCalls,
        },
        sessionId: event.result.sessionId,
      };
    case "reply":
      return {
        type: "reply",
        text: event.text,
        ts: event.ts,
        sessionId: event.sessionId,
        runId: event.runId,
      };
    default:
      return null;
  }
}
