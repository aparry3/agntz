import { createRunner } from "@agntz/core";
import type {
  Runner,
  InvokeResult,
  ModelProvider,
  StreamEvent as CoreStreamEvent,
} from "@agntz/core";
import type { AgentManifest } from "@agntz/manifest";
import type {
  Run,
  RunInput,
  RunListFilter,
  RunListResult,
  RunResult,
  StreamEvent,
  TraceDetail,
  TraceFilter,
  TracesListResult,
} from "@agntz/sdk";
import { loadManifestsFromDir } from "./loader.js";
import { manifestToAgentDefinition } from "./manifest-to-agent.js";
import { toolMapToDefinitions, type LocalToolMap } from "./tools.js";
import {
  buildRunRecord,
  buildTraceFromInvocation,
  RunsBuffer,
  TracesBuffer,
} from "./buffers.js";

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
  /**
   * Ring buffer capacity for `.runs.list/.get`. Once exceeded, the oldest
   * record drops off. Default 1000.
   */
  runsCapacity?: number;
  /**
   * Ring buffer capacity for `.traces.list/.get`. Default 1000.
   */
  tracesCapacity?: number;
  /**
   * Called for every low-level event the runner emits during `.agents.stream`
   * calls. Use this for custom logging, persistence, or piping events into
   * an external observability backend. No-op for `.agents.run` (the
   * non-streaming path emits no intermediate events).
   */
  onEvent?: (event: CoreStreamEvent) => void;
}

/**
 * The minimal client surface for embedded agent execution. Mirrors the
 * hosted `AgntzClient` from `@agntz/sdk` so user code can graduate to the
 * remote API by swapping a single import line.
 */
export interface LocalClient {
  readonly agents: LocalAgentsResource;
  readonly runs: LocalRunsResource;
  readonly traces: LocalTracesResource;
  /** Map of loaded agent manifests keyed by id. Useful for introspection. */
  readonly manifests: ReadonlyMap<string, AgentManifest>;
  /** Underlying core runner. Escape hatch for power users. */
  readonly _runner: Runner;
}

export interface LocalAgentsResource {
  run(input: RunInput): Promise<RunResult>;
  stream(input: RunInput): AsyncGenerator<StreamEvent, void, void>;
}

export interface LocalRunsResource {
  list(filter?: RunListFilter): Promise<RunListResult>;
  get(id: string): Promise<Run | null>;
}

export interface LocalTracesResource {
  list(filter?: TraceFilter): Promise<TracesListResult>;
  get(traceId: string): Promise<TraceDetail | null>;
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

  return new LocalClientImpl(runner, manifests, opts);
}

class LocalClientImpl implements LocalClient {
  readonly agents: LocalAgentsResource;
  readonly runs: LocalRunsResource;
  readonly traces: LocalTracesResource;
  constructor(
    readonly _runner: Runner,
    readonly manifests: ReadonlyMap<string, AgentManifest>,
    opts: AgntzLocalOptions,
  ) {
    const runsBuffer = new RunsBuffer({ capacity: opts.runsCapacity });
    const tracesBuffer = new TracesBuffer({ capacity: opts.tracesCapacity });
    this.agents = new AgentsResourceImpl(_runner, runsBuffer, tracesBuffer, opts.onEvent);
    this.runs = new RunsResourceImpl(runsBuffer);
    this.traces = new TracesResourceImpl(tracesBuffer);
  }
}

class AgentsResourceImpl implements LocalAgentsResource {
  constructor(
    private readonly runner: Runner,
    private readonly runsBuffer: RunsBuffer,
    private readonly tracesBuffer: TracesBuffer,
    private readonly onEvent: ((event: CoreStreamEvent) => void) | undefined,
  ) {}

  async run(input: RunInput): Promise<RunResult> {
    const runId = generateRunId();
    const startedAt = Date.now();
    const inputAsString = inputToString(input.input);
    try {
      const result = await this.runner.invoke(input.agentId, normalizeInput(input.input), {
        sessionId: input.sessionId,
        signal: input.signal,
      });
      const endedAt = Date.now();
      this.recordSuccess(runId, input.agentId, inputAsString, result, startedAt, endedAt);
      return invokeResultToRunResult(result);
    } catch (e) {
      const endedAt = Date.now();
      this.recordFailure(runId, input.agentId, inputAsString, e, startedAt, endedAt);
      throw e;
    }
  }

  async *stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
    const runId = generateRunId();
    const startedAt = Date.now();
    const inputAsString = inputToString(input.input);
    const iter = this.runner.stream(input.agentId, normalizeInput(input.input), {
      sessionId: input.sessionId,
      signal: input.signal,
    });
    if (input.sessionId) {
      yield { type: "start", agentId: input.agentId, kind: "llm", sessionId: input.sessionId };
    }
    let finalResult: InvokeResult | undefined;
    try {
      for await (const event of iter) {
        this.onEvent?.(event);
        if (event.type === "done") finalResult = event.result;
        const mapped = mapStreamEvent(event);
        if (mapped) yield mapped;
      }
      const endedAt = Date.now();
      if (finalResult) {
        this.recordSuccess(runId, input.agentId, inputAsString, finalResult, startedAt, endedAt);
      }
    } catch (e) {
      const endedAt = Date.now();
      this.recordFailure(runId, input.agentId, inputAsString, e, startedAt, endedAt);
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
      throw e;
    }
  }

  private recordSuccess(
    runId: string,
    agentId: string,
    inputAsString: string,
    result: InvokeResult,
    startedAt: number,
    endedAt: number,
  ): void {
    this.runsBuffer.record(
      buildRunRecord({ runId, agentId, inputAsString, status: "completed", result, startedAt, endedAt }),
    );
    this.tracesBuffer.record(
      buildTraceFromInvocation({ runId, agentId, result, startedAt, endedAt }),
    );
  }

  private recordFailure(
    runId: string,
    agentId: string,
    inputAsString: string,
    error: unknown,
    startedAt: number,
    endedAt: number,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.runsBuffer.record(
      buildRunRecord({ runId, agentId, inputAsString, status: "failed", error: message, startedAt, endedAt }),
    );
    this.tracesBuffer.record(
      buildTraceFromInvocation({ runId, agentId, error: message, startedAt, endedAt }),
    );
  }
}

class RunsResourceImpl implements LocalRunsResource {
  constructor(private readonly buffer: RunsBuffer) {}
  async list(filter: RunListFilter = {}): Promise<RunListResult> {
    return this.buffer.list(filter);
  }
  async get(id: string): Promise<Run | null> {
    return this.buffer.get(id);
  }
}

class TracesResourceImpl implements LocalTracesResource {
  constructor(private readonly buffer: TracesBuffer) {}
  async list(filter: TraceFilter = {}): Promise<TracesListResult> {
    return this.buffer.list(filter);
  }
  async get(traceId: string): Promise<TraceDetail | null> {
    return this.buffer.get(traceId);
  }
}

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInput(input: RunInput["input"]): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

function inputToString(input: RunInput["input"]): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
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
 * a `complete` event.
 */
function mapStreamEvent(event: CoreStreamEvent): StreamEvent | null {
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
