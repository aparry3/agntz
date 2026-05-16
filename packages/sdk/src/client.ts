import { StreamError } from "./errors.js";
import { normalizeEvent, normalizeRunEvent, normalizeTraceLiveEvent } from "./events.js";
import { composeSignal, sendRequest } from "./fetch.js";
import { parseSSE } from "./sse.js";
import type {
  AgntzClientOptions,
  HealthResult,
  MultiplexedRunEvent,
  Run,
  RunInput,
  RunListFilter,
  RunListResult,
  RunResult,
  RunsStartInput,
  RunsStreamInput,
  StreamEvent,
  TraceDetail,
  TraceFilter,
  TraceLiveEvent,
  TracesListResult,
} from "./types.js";

export class AgntzClient {
  readonly agents: AgentsResource;
  readonly runs: RunsResource;
  readonly traces: TracesResource;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultSignal?: AbortSignal;

  constructor(opts: AgntzClientOptions) {
    if (!opts.apiKey) throw new Error("AgntzClient: apiKey is required");
    if (!opts.baseUrl) throw new Error("AgntzClient: baseUrl is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.fetchImpl = opts.fetch ?? fetch;
    this.defaultSignal = opts.defaultSignal;
    this.agents = new AgentsResource(this);
    this.runs = new RunsResource(this);
    this.traces = new TracesResource(this);
  }

  /** @internal */
  get _apiKey(): string { return this.apiKey; }
  /** @internal */
  get _baseUrl(): string { return this.baseUrl; }
  /** @internal */
  get _fetchImpl(): typeof fetch { return this.fetchImpl; }
  /** @internal */
  _composeSignal(signal?: AbortSignal): AbortSignal | undefined {
    return composeSignal(this.defaultSignal, signal);
  }

  async health(): Promise<HealthResult> {
    const res = await sendRequest({
      baseUrl: this.baseUrl,
      path: "/health",
      method: "GET",
      fetchImpl: this.fetchImpl,
      signal: this.defaultSignal,
    });
    return (await res.json()) as HealthResult;
  }

  /** @internal */
  _runRequest(input: RunInput, stream: boolean): Promise<Response> {
    const signal = composeSignal(this.defaultSignal, input.signal);
    const body: Record<string, unknown> = { agentId: input.agentId };
    if (input.input !== undefined) body.input = input.input;
    if (input.sessionId !== undefined) body.sessionId = input.sessionId;
    return sendRequest({
      baseUrl: this.baseUrl,
      path: stream ? "/run/stream" : "/run",
      method: "POST",
      apiKey: this.apiKey,
      body,
      signal,
      accept: stream ? "text/event-stream" : undefined,
      fetchImpl: this.fetchImpl,
    });
  }

  /** @internal */
  _resolveStreamSignal(input: RunInput): AbortSignal | undefined {
    return composeSignal(this.defaultSignal, input.signal);
  }
}

export class AgentsResource {
  constructor(private readonly client: AgntzClient) {}

  async run(input: RunInput): Promise<RunResult> {
    const res = await this.client._runRequest(input, false);
    return (await res.json()) as RunResult;
  }

  stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
    return streamAgentEvents(this.client, input);
  }
}

export class RunsResource {
  constructor(private readonly client: AgntzClient) {}

  /** Start a run and return its handle immediately (status: "running"). */
  async start(input: RunsStartInput): Promise<Run> {
    const signal = this.client._composeSignal(input.signal);
    const body: Record<string, unknown> = { agentId: input.agentId };
    if (input.input !== undefined) body.input = input.input;
    if (input.sessionId !== undefined) body.sessionId = input.sessionId;
    if (input.callbackUrl !== undefined) body.callbackUrl = input.callbackUrl;
    if (input.webhookSecretName !== undefined) body.webhookSecretName = input.webhookSecretName;
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path: "/runs",
      method: "POST",
      apiKey: this.client._apiKey,
      body,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as Run;
  }

  /** Fetch the current state of a Run (live registry or durable store). */
  async get(runId: string, opts: { signal?: AbortSignal } = {}): Promise<Run> {
    const signal = this.client._composeSignal(opts.signal);
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path: `/runs/${encodeURIComponent(runId)}`,
      method: "GET",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as Run;
  }

  /**
   * Stream multiplexed events for a Run's subtree. Pass `since` to resume
   * from a specific seq after a reconnect. If the Run has been evicted, the
   * stream emits a single `snapshot` event and closes.
   */
  stream(input: RunsStreamInput): AsyncGenerator<MultiplexedRunEvent, void, void> {
    return streamRunEvents(this.client, input);
  }

  /** Cancel a Run and cascade to all descendants. */
  async cancel(runId: string, opts: { signal?: AbortSignal } = {}): Promise<Run> {
    const signal = this.client._composeSignal(opts.signal);
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path: `/runs/${encodeURIComponent(runId)}/cancel`,
      method: "POST",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as Run;
  }

  /** List runs for the authenticated user, with optional filters and cursor-based pagination. */
  async list(
    filter: RunListFilter = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<RunListResult> {
    const signal = this.client._composeSignal(opts.signal);
    const qs = new URLSearchParams();
    if (filter.rootsOnly !== undefined) qs.set("rootsOnly", String(filter.rootsOnly));
    if (filter.agentId) qs.set("agentId", filter.agentId);
    if (filter.status) qs.set("status", filter.status);
    if (filter.startedAfter) qs.set("startedAfter", filter.startedAfter);
    if (filter.startedBefore) qs.set("startedBefore", filter.startedBefore);
    if (filter.limit !== undefined) qs.set("limit", String(filter.limit));
    if (filter.cursor) qs.set("cursor", filter.cursor);

    const path = qs.toString() ? `/runs?${qs.toString()}` : "/runs";
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path,
      method: "GET",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as RunListResult;
  }
}

export class TracesResource {
  constructor(private readonly client: AgntzClient) {}

  async list(
    filter: TraceFilter = {},
    opts: { signal?: AbortSignal } = {},
  ): Promise<TracesListResult> {
    const signal = this.client._composeSignal(opts.signal);
    const qs = encodeTraceFilter(filter);
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path: qs ? `/traces?${qs}` : "/traces",
      method: "GET",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as TracesListResult;
  }

  async get(traceId: string, opts: { signal?: AbortSignal } = {}): Promise<TraceDetail> {
    const signal = this.client._composeSignal(opts.signal);
    const res = await sendRequest({
      baseUrl: this.client._baseUrl,
      path: `/traces/${encodeURIComponent(traceId)}`,
      method: "GET",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
    return (await res.json()) as TraceDetail;
  }

  stream(
    traceId: string,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<TraceLiveEvent, void, void> {
    return streamTraceEvents(this.client, traceId, opts.signal);
  }

  async delete(traceId: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = this.client._composeSignal(opts.signal);
    await sendRequest({
      baseUrl: this.client._baseUrl,
      path: `/traces/${encodeURIComponent(traceId)}`,
      method: "DELETE",
      apiKey: this.client._apiKey,
      signal,
      fetchImpl: this.client._fetchImpl,
    });
  }
}

function encodeTraceFilter(filter: TraceFilter): string {
  const params = new URLSearchParams();
  if (filter.agentId !== undefined) params.set("agentId", filter.agentId);
  if (filter.status !== undefined) params.set("status", filter.status);
  if (filter.startedAfter !== undefined) params.set("startedAfter", filter.startedAfter);
  if (filter.startedBefore !== undefined) params.set("startedBefore", filter.startedBefore);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.cursor !== undefined) params.set("cursor", filter.cursor);
  return params.toString();
}

async function* streamTraceEvents(
  client: AgntzClient,
  traceId: string,
  signalIn?: AbortSignal,
): AsyncGenerator<TraceLiveEvent, void, void> {
  const signal = client._composeSignal(signalIn);
  const res = await sendRequest({
    baseUrl: client._baseUrl,
    path: `/traces/${encodeURIComponent(traceId)}/stream`,
    method: "GET",
    apiKey: client._apiKey,
    signal,
    accept: "text/event-stream",
    fetchImpl: client._fetchImpl,
  });
  if (!res.body) {
    throw new StreamError("Worker returned no stream body", { status: res.status });
  }

  for await (const frame of parseSSE(res.body, signal)) {
    const ev = normalizeTraceLiveEvent(frame);
    if (!ev) continue;
    yield ev;
    // snapshot and trace-done both terminate the stream.
    if (ev.type === "snapshot" || ev.type === "trace-done") return;
  }
}

async function* streamRunEvents(
  client: AgntzClient,
  input: RunsStreamInput,
): AsyncGenerator<MultiplexedRunEvent, void, void> {
  const signal = client._composeSignal(input.signal);
  const path =
    `/runs/${encodeURIComponent(input.runId)}/stream` +
    (typeof input.since === "number" ? `?since=${input.since}` : "");
  const res = await sendRequest({
    baseUrl: client._baseUrl,
    path,
    method: "GET",
    apiKey: client._apiKey,
    signal,
    accept: "text/event-stream",
    fetchImpl: client._fetchImpl,
  });
  if (!res.body) {
    throw new StreamError("Worker returned no stream body", { status: res.status });
  }

  for await (const frame of parseSSE(res.body, signal)) {
    const ev = normalizeRunEvent(frame);
    if (!ev) continue;
    yield ev;
    if (ev.type === "snapshot" || ev.type === "run-complete" || ev.type === "run-error" || ev.type === "run-cancelled") {
      // For root terminal or snapshot, close the iterator cleanly.
      if (ev.type === "snapshot" || ev.runId === input.runId) {
        return;
      }
    }
  }
}

async function* streamAgentEvents(
  client: AgntzClient,
  input: RunInput,
): AsyncGenerator<StreamEvent, void, void> {
  const res = await client._runRequest(input, true);
  if (!res.body) {
    throw new StreamError("Worker returned no stream body", { status: res.status });
  }
  const signal = client._resolveStreamSignal(input);
  let sawTerminal = false;
  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  if (signal) {
    if (signal.aborted) aborted = true;
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    for await (const frame of parseSSE(res.body, signal)) {
      const event = normalizeEvent(frame);
      if (!event) continue;
      if (event.type === "complete" || event.type === "error") {
        sawTerminal = true;
      }
      yield event;
      if (sawTerminal) return;
    }
    if (!sawTerminal && !aborted) {
      throw new StreamError("Stream closed before completion", {
        code: "STREAM_TRUNCATED",
      });
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
