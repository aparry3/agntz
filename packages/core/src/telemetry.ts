import type { TokenUsage, ToolCallRecord, Span, SpanKind, TraceSink } from "./types.js";
import type { AiSdkMessage, AiMessagePart } from "./message-builder.js";

// ───────────────────────────────────────────────────────────────────────
// OTel passthrough — unchanged from prior slice
// ───────────────────────────────────────────────────────────────────────

export interface OTelTracer {
  startSpan(name: string, options?: OTelSpanOptions, context?: unknown): OTelSpan;
}
export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: { code: number; message?: string }): this;
  recordException(exception: Error | string): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}
export interface OTelSpanOptions {
  kind?: number;
  attributes?: Record<string, string | number | boolean>;
}

let otelApi: any = null;
function getOTelApi(): any {
  if (otelApi === undefined) return null;
  if (otelApi !== null) return otelApi;
  try {
    otelApi = require("@opentelemetry/api");
    return otelApi;
  } catch {
    otelApi = undefined;
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// SpanEmitter config
// ───────────────────────────────────────────────────────────────────────

export interface TelemetryConfig {
  /** Optional OTel tracer for export-only forwarding. */
  tracer?: OTelTracer;
  /** Tracer name for global tracer lookup. Default "agntz". */
  tracerName?: string;
  /** Whether to include input/output text in span attributes. Default false. */
  recordIO?: boolean;
  /** Whether to include tool call inputs/outputs. Default false. */
  recordToolIO?: boolean;
  /** Static attributes applied to every span. */
  baseAttributes?: Record<string, string | number | boolean>;
  /** Native sink — invoked on every span-start / span-end / trace-done. */
  traceSink?: TraceSink;
}

// ───────────────────────────────────────────────────────────────────────
// Span handles — same outward shape as the prior Telemetry class
// ───────────────────────────────────────────────────────────────────────

export interface RunSpan {
  end(): void;
  error(err: Error | string): void;
}
export interface ManifestSpan {
  step(params: { name: string; index: number }): StepSpan;
  end(): void;
  error(err: Error | string): void;
}
export interface StepSpan {
  end(): void;
  error(err: Error | string): void;
}
export interface InvokeSpan {
  modelCall(params: { model: string; step: number }): ModelCallSpan;
  toolCall(params: { toolName: string; toolCallId: string }): ToolCallSpan;
  setResult(result: { output?: string; usage: TokenUsage; duration: number; toolCallCount: number; stepCount: number }): void;
  end(): void;
  error(err: Error | string): void;
}
export interface ModelCallSpan {
  setResult(result: {
    usage: TokenUsage;
    finishReason?: string;
    toolCallCount: number;
    costUsd?: number;
    prompt?: AiSdkMessage[];
    completion?: string;
  }): void;
  end(): void;
  error(err: Error | string): void;
}
export interface ToolCallSpan {
  setResult(record: ToolCallRecord): void;
  end(): void;
  error(err: Error | string): void;
}

// ───────────────────────────────────────────────────────────────────────
// SpanEmitter — stack-based parentage + dual sinks
// ───────────────────────────────────────────────────────────────────────

/**
 * Threaded per-request through ExecutionContext + InvokeOptions. Maintains
 * a per-trace stack of active spans so cross-layer parent linkage works
 * without explicit threading.
 */
export class SpanEmitter {
  private config: TelemetryConfig;
  private tracer: OTelTracer | null;
  private stack: Array<{ spanId: string; traceId: string; ownerId: string; runId: string | null; sessionId: string | null }> = [];

  constructor(config?: TelemetryConfig) {
    this.config = config ?? {};
    if (config?.tracer) {
      this.tracer = config.tracer;
    } else if (config) {
      // Only try global OTel tracer when caller explicitly passed a config object.
      const api = getOTelApi();
      this.tracer = api ? api.trace.getTracer(config.tracerName ?? "agntz") : null;
    } else {
      // No config at all — no-op mode.
      this.tracer = null;
    }
  }

  /** Returns true iff at least one sink is active (OTel or native). */
  get enabled(): boolean {
    return this.tracer !== null || this.config.traceSink !== undefined;
  }

  startRun(params: { ownerId: string; runId: string; sessionId?: string | null; agentId: string }): RunSpan {
    const span = this.openSpan("run", "agent.run", {
      ownerId: params.ownerId,
      runId: params.runId,
      sessionId: params.sessionId ?? null,
      attrs: { "agent.id": params.agentId, "agent.run.id": params.runId },
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startManifest(params: { ownerId: string; agentId: string; kind: string; runId?: string | null; sessionId?: string | null }): ManifestSpan {
    const span = this.openSpan("manifest", "agent.manifest", {
      ownerId: params.ownerId,
      runId: params.runId ?? null,
      sessionId: params.sessionId ?? null,
      attrs: { "agent.id": params.agentId, "manifest.kind": params.kind },
    });
    return {
      step: (sp) => this.startStepInternal(sp, span),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startStep(params: { name: string; index: number; ownerId: string; runId?: string | null }): StepSpan {
    const span = this.openSpan("step", "agent.step", {
      ownerId: params.ownerId,
      runId: params.runId ?? null,
      sessionId: null,
      attrs: { "step.name": params.name, "step.index": params.index },
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startInvoke(params: {
    agentId: string;
    invocationId: string;
    model: string;
    ownerId?: string;
    sessionId?: string | null;
    runId?: string | null;
    contextIds?: string[];
    input?: string;
  }): InvokeSpan {
    const ownerId = params.ownerId ?? "unknown";
    const attrs: Record<string, string | number | boolean> = {
      "agent.id": params.agentId,
      "agent.invocation.id": params.invocationId,
      "agent.model": params.model,
      ...this.config.baseAttributes,
    };
    if (params.sessionId) attrs["agent.session.id"] = params.sessionId;
    if (params.runId) attrs["agent.run.id"] = params.runId;
    if (params.contextIds?.length) attrs["agent.context.ids"] = params.contextIds.join(",");
    if (this.config.recordIO && params.input) attrs["agent.input"] = params.input.slice(0, 4096);

    const span = this.openSpan("invoke", "agent.invoke", {
      ownerId,
      runId: params.runId ?? null,
      sessionId: params.sessionId ?? null,
      attrs,
    });

    const handle = this;
    return {
      modelCall: (mp) => handle.startModelCallInternal(mp, span),
      toolCall: (tp) => handle.startToolCallInternal(tp, span),
      setResult: (result) => handle.setInvokeResultInternal(span, result),
      end: () => handle.closeSpan(span, "ok"),
      error: (err) => handle.closeSpan(span, "error", err),
    };
  }

  // ─── private helpers ─────

  private startStepInternal(params: { name: string; index: number }, parent: SpanState): StepSpan {
    const span = this.openSpan("step", "agent.step", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "step.name": params.name, "step.index": params.index },
      explicitParent: parent,
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private startModelCallInternal(params: { model: string; step: number }, parent: SpanState): ModelCallSpan {
    const span = this.openSpan("model", "agent.model.call", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "agent.model": params.model, "agent.step": params.step },
      explicitParent: parent,
    });
    return {
      setResult: (r) => this.setModelResult(span, r),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private startToolCallInternal(params: { toolName: string; toolCallId: string }, parent: SpanState): ToolCallSpan {
    const span = this.openSpan("tool", "agent.tool.execute", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "agent.tool.name": params.toolName, "agent.tool.call.id": params.toolCallId },
      explicitParent: parent,
    });
    return {
      setResult: (record) => this.setToolResult(span, record),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private openSpan(kind: SpanKind, name: string, opts: OpenOpts): SpanState {
    const parent = opts.explicitParent ?? (this.stack.length > 0 ? this.stack[this.stack.length - 1] : null);
    const traceId = parent ? parent.traceId : `tr_${ulid()}`;
    const spanId = `sp_${ulid()}`;
    const startedAt = new Date().toISOString();

    const state: SpanState = {
      spanId,
      traceId,
      parentId: parent ? parent.spanId : null,
      ownerId: opts.ownerId,
      runId: opts.runId,
      sessionId: opts.sessionId,
      kind,
      name,
      startedAt,
      attrs: opts.attrs ?? {},
      otel: this.tracer ? this.tracer.startSpan(name, { attributes: opts.attrs ?? {} }) : null,
    };

    // Only push to stack if NOT using an explicit parent — explicit-parent spans
    // are siblings, not nested children of whatever's currently on top.
    if (!opts.explicitParent) this.stack.push({ spanId, traceId, ownerId: opts.ownerId, runId: opts.runId, sessionId: opts.sessionId });

    if (this.config.traceSink) {
      const span: Span = stateToSpan(state, "running");
      this.config.traceSink({ type: "span-start", span });
    }

    return state;
  }

  private closeSpan(state: SpanState, status: "ok" | "error", err?: Error | string): void {
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt).getTime() - new Date(state.startedAt).getTime();
    state.endedAt = endedAt;
    state.durationMs = durationMs;
    state.status = status;
    if (status === "error" && err) {
      state.error = err instanceof Error ? err.message : err;
    }

    if (state.otel) {
      state.otel.setStatus({ code: status === "ok" ? 1 : 2, message: state.error ?? undefined });
      if (err instanceof Error) state.otel.recordException(err);
      state.otel.end();
    }

    if (this.config.traceSink) {
      this.config.traceSink({
        type: "span-end",
        spanId: state.spanId,
        patch: { endedAt, durationMs, status, error: state.error ?? null, attributes: state.attrs },
      });
    }

    // Pop our stack frame if this was a stack-managed span.
    const top = this.stack[this.stack.length - 1];
    if (top && top.spanId === state.spanId) this.stack.pop();
  }

  private setInvokeResultInternal(state: SpanState, result: { output?: string; usage: TokenUsage; duration: number; toolCallCount: number; stepCount: number }): void {
    state.attrs["agent.usage.prompt_tokens"] = result.usage.promptTokens;
    state.attrs["agent.usage.completion_tokens"] = result.usage.completionTokens;
    state.attrs["agent.usage.total_tokens"] = result.usage.totalTokens;
    state.attrs["agent.duration_ms"] = result.duration;
    state.attrs["agent.tool_call_count"] = result.toolCallCount;
    state.attrs["agent.step_count"] = result.stepCount;
    if (this.config.recordIO && result.output) state.attrs["agent.output"] = result.output.slice(0, 4096);
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }

  private setModelResult(
    state: SpanState,
    r: {
      usage: TokenUsage;
      finishReason?: string;
      toolCallCount: number;
      costUsd?: number;
      prompt?: AiSdkMessage[];
      completion?: string;
    },
  ): void {
    state.attrs["agent.usage.prompt_tokens"] = r.usage.promptTokens;
    state.attrs["agent.usage.completion_tokens"] = r.usage.completionTokens;
    state.attrs["agent.usage.total_tokens"] = r.usage.totalTokens;
    state.attrs["agent.tool_call_count"] = r.toolCallCount;
    if (r.usage.model) state.attrs["agent.model"] = r.usage.model;
    if (r.finishReason) state.attrs["agent.finish_reason"] = r.finishReason;
    if (typeof r.costUsd === "number") state.attrs["agent.cost_usd"] = r.costUsd;
    if (this.config.recordIO) {
      if (r.prompt) {
        state.attrs["agent.prompt"] = JSON.stringify(sanitizeMessagesForTrace(r.prompt));
      }
      if (r.completion) {
        state.attrs["agent.completion"] = r.completion.slice(0, 4096);
      }
    }
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }

  private setToolResult(state: SpanState, record: ToolCallRecord): void {
    state.attrs["agent.tool.duration_ms"] = record.duration;
    if (record.error) state.attrs["agent.tool.error"] = record.error;
    if (this.config.recordToolIO) {
      state.attrs["agent.tool.input"] = JSON.stringify(record.input).slice(0, 4096);
      state.attrs["agent.tool.output"] = JSON.stringify(record.output).slice(0, 4096);
    }
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Backward-compat: Telemetry class re-exports SpanEmitter under the old name
// ───────────────────────────────────────────────────────────────────────

export class Telemetry extends SpanEmitter {}

// ───────────────────────────────────────────────────────────────────────
// Internal types
// ───────────────────────────────────────────────────────────────────────

interface SpanState {
  spanId: string;
  traceId: string;
  parentId: string | null;
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  kind: SpanKind;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status?: "ok" | "error";
  error?: string | null;
  attrs: Record<string, string | number | boolean>;
  otel: OTelSpan | null;
}

interface OpenOpts {
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  attrs?: Record<string, string | number | boolean>;
  /** If set, parent is this state directly (used by `manifest.step()` and invoke child spans). */
  explicitParent?: SpanState;
}

function stateToSpan(s: SpanState, status: "running" | "ok" | "error" | "cancelled"): Span {
  return {
    spanId: s.spanId,
    traceId: s.traceId,
    parentId: s.parentId,
    ownerId: s.ownerId,
    runId: s.runId,
    sessionId: s.sessionId,
    name: s.name,
    kind: s.kind,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    durationMs: s.durationMs ?? null,
    status,
    error: s.error ?? null,
    attributes: { ...s.attrs },
    events: [],
    scores: {},
    costUsd: typeof s.attrs["agent.cost_usd"] === "number" ? s.attrs["agent.cost_usd"] as number : null,
  };
}

// ULID — short, sortable, URL-safe ID.
function ulid(): string {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

const PROMPT_PER_MESSAGE_CAP = 4096;

function sanitizeMessagesForTrace(messages: AiSdkMessage[]): Array<{
  role: string;
  content: string | Array<{ type: string; text?: string; mediaType?: string; size?: number }>;
}> {
  return messages.map((m) => ({
    role: m.role,
    content: sanitizeContent(m.content),
  }));
}

function sanitizeContent(
  content: string | AiMessagePart[],
): string | Array<{ type: string; text?: string; mediaType?: string; size?: number }> {
  if (typeof content === "string") {
    return content.length > PROMPT_PER_MESSAGE_CAP
      ? content.slice(0, PROMPT_PER_MESSAGE_CAP)
      : content;
  }
  return content.map((part) => sanitizePart(part));
}

function sanitizePart(
  part: AiMessagePart,
): { type: string; text?: string; mediaType?: string; size?: number } {
  if (part.type === "text") {
    return {
      type: "text",
      text:
        part.text.length > PROMPT_PER_MESSAGE_CAP
          ? part.text.slice(0, PROMPT_PER_MESSAGE_CAP)
          : part.text,
    };
  }
  // image — drop the base64 payload, keep the metadata so the trace shows
  // that the model saw an image without ballooning the attribute.
  return {
    type: "image",
    mediaType: part.mediaType,
    size: part.image.length,
  };
}
