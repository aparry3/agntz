/**
 * OpenTelemetry integration for agntz.
 *
 * Opt-in: pass `telemetry` config to `createRunner()`.
 * Uses `@opentelemetry/api` — users bring their own SDK/exporter setup.
 *
 * Span hierarchy:
 *   agent.invoke (root)
 *   ├── agent.model.call (each LLM call)
 *   ├── agent.tool.execute (each tool call)
 *   │   └── agent.invoke (nested agent-as-tool)
 *   └── agent.context.load (context loading)
 */

import type { TokenUsage, ToolCallRecord } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════
// Types — mirrors @opentelemetry/api to avoid hard dependency
// ═══════════════════════════════════════════════════════════════════════

/**
 * Minimal Tracer interface matching @opentelemetry/api Tracer.
 * Users pass their real OTel tracer; we only use these methods.
 */
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

// OTel API helpers — loaded dynamically to avoid hard dependency
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

// ═══════════════════════════════════════════════════════════════════════
// Telemetry Configuration
// ═══════════════════════════════════════════════════════════════════════

export interface TelemetryConfig {
  /** An OpenTelemetry Tracer instance. If not provided, uses the global tracer. */
  tracer?: OTelTracer;
  /** Tracer name for global tracer lookup (default: "agntz") */
  tracerName?: string;
  /** Whether to record input/output text in span attributes (default: false for privacy) */
  recordIO?: boolean;
  /** Whether to record tool call inputs/outputs (default: false) */
  recordToolIO?: boolean;
  /** Custom attributes to add to every span */
  baseAttributes?: Record<string, string | number | boolean>;
}

// ═══════════════════════════════════════════════════════════════════════
// Telemetry Helper — wraps span lifecycle
// ═══════════════════════════════════════════════════════════════════════

/**
 * Telemetry helper for instrumenting runner operations.
 * If telemetry is not configured, all methods are no-ops.
 */
export class Telemetry {
  private tracer: OTelTracer | null;
  private config: TelemetryConfig;

  constructor(config?: TelemetryConfig) {
    this.config = config ?? {};

    if (config?.tracer) {
      this.tracer = config.tracer;
    } else if (config) {
      // Try to get global tracer from @opentelemetry/api
      const api = getOTelApi();
      if (api) {
        this.tracer = api.trace.getTracer(config.tracerName ?? "agntz");
      } else {
        this.tracer = null;
      }
    } else {
      this.tracer = null;
    }
  }

  /** Whether telemetry is active */
  get enabled(): boolean {
    return this.tracer !== null;
  }

  /**
   * Start an invocation span.
   */
  startInvoke(params: {
    agentId: string;
    invocationId: string;
    model: string;
    sessionId?: string;
    contextIds?: string[];
    input?: string;
  }): InvokeSpan {
    if (!this.tracer) return NO_OP_INVOKE_SPAN;

    const attrs: Record<string, string | number | boolean> = {
      "agent.id": params.agentId,
      "agent.invocation.id": params.invocationId,
      "agent.model": params.model,
      ...this.config.baseAttributes,
    };

    if (params.sessionId) attrs["agent.session.id"] = params.sessionId;
    if (params.contextIds?.length) attrs["agent.context.ids"] = params.contextIds.join(",");
    if (this.config.recordIO && params.input) {
      attrs["agent.input"] = params.input.slice(0, 4096); // Truncate for safety
    }

    const span = this.tracer.startSpan("agent.invoke", { attributes: attrs });

    return new ActiveInvokeSpan(span, this.tracer, this.config);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Span Interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface InvokeSpan {
  /** Record a model (LLM) call */
  modelCall(params: {
    model: string;
    step: number;
  }): ModelCallSpan;

  /** Record a tool execution */
  toolCall(params: {
    toolName: string;
    toolCallId: string;
  }): ToolCallSpan;

  /** Set final result attributes */
  setResult(result: {
    output?: string;
    usage: TokenUsage;
    duration: number;
    toolCallCount: number;
    stepCount: number;
  }): void;

  /** End the span with success */
  end(): void;

  /** End the span with an error */
  error(err: Error | string): void;
}

export interface ModelCallSpan {
  setResult(result: {
    usage: TokenUsage;
    finishReason?: string;
    toolCallCount: number;
  }): void;
  end(): void;
  error(err: Error | string): void;
}

export interface ToolCallSpan {
  setResult(record: ToolCallRecord): void;
  end(): void;
  error(err: Error | string): void;
}

// ═══════════════════════════════════════════════════════════════════════
// Active Span Implementations
// ═══════════════════════════════════════════════════════════════════════

class ActiveInvokeSpan implements InvokeSpan {
  constructor(
    private span: OTelSpan,
    private tracer: OTelTracer,
    private config: TelemetryConfig,
  ) {}

  modelCall(params: { model: string; step: number }): ModelCallSpan {
    const span = this.tracer.startSpan("agent.model.call", {
      attributes: {
        "agent.model": params.model,
        "agent.step": params.step,
      },
    });
    return new ActiveModelCallSpan(span);
  }

  toolCall(params: { toolName: string; toolCallId: string }): ToolCallSpan {
    const span = this.tracer.startSpan("agent.tool.execute", {
      attributes: {
        "agent.tool.name": params.toolName,
        "agent.tool.call.id": params.toolCallId,
      },
    });
    return new ActiveToolCallSpan(span, this.config);
  }

  setResult(result: {
    output?: string;
    usage: TokenUsage;
    duration: number;
    toolCallCount: number;
    stepCount: number;
  }): void {
    this.span.setAttribute("agent.usage.prompt_tokens", result.usage.promptTokens);
    this.span.setAttribute("agent.usage.completion_tokens", result.usage.completionTokens);
    this.span.setAttribute("agent.usage.total_tokens", result.usage.totalTokens);
    this.span.setAttribute("agent.duration_ms", result.duration);
    this.span.setAttribute("agent.tool_call_count", result.toolCallCount);
    this.span.setAttribute("agent.step_count", result.stepCount);

    if (this.config.recordIO && result.output) {
      this.span.setAttribute("agent.output", result.output.slice(0, 4096));
    }
  }

  end(): void {
    this.span.setStatus({ code: 1 }); // OK
    this.span.end();
  }

  error(err: Error | string): void {
    const message = err instanceof Error ? err.message : err;
    this.span.setStatus({ code: 2, message }); // ERROR
    if (err instanceof Error) {
      this.span.recordException(err);
    }
    this.span.end();
  }
}

class ActiveModelCallSpan implements ModelCallSpan {
  constructor(private span: OTelSpan) {}

  setResult(result: {
    usage: TokenUsage;
    finishReason?: string;
    toolCallCount: number;
  }): void {
    this.span.setAttribute("agent.usage.prompt_tokens", result.usage.promptTokens);
    this.span.setAttribute("agent.usage.completion_tokens", result.usage.completionTokens);
    this.span.setAttribute("agent.usage.total_tokens", result.usage.totalTokens);
    this.span.setAttribute("agent.tool_call_count", result.toolCallCount);
    if (result.finishReason) {
      this.span.setAttribute("agent.finish_reason", result.finishReason);
    }
  }

  end(): void {
    this.span.setStatus({ code: 1 });
    this.span.end();
  }

  error(err: Error | string): void {
    const message = err instanceof Error ? err.message : err;
    this.span.setStatus({ code: 2, message });
    if (err instanceof Error) this.span.recordException(err);
    this.span.end();
  }
}

class ActiveToolCallSpan implements ToolCallSpan {
  constructor(private span: OTelSpan, private config: TelemetryConfig) {}

  setResult(record: ToolCallRecord): void {
    this.span.setAttribute("agent.tool.duration_ms", record.duration);
    if (record.error) {
      this.span.setAttribute("agent.tool.error", record.error);
    }
    if (this.config.recordToolIO) {
      this.span.setAttribute("agent.tool.input", JSON.stringify(record.input).slice(0, 4096));
      this.span.setAttribute("agent.tool.output", JSON.stringify(record.output).slice(0, 4096));
    }
  }

  end(): void {
    this.span.setStatus({ code: 1 });
    this.span.end();
  }

  error(err: Error | string): void {
    const message = err instanceof Error ? err.message : err;
    this.span.setStatus({ code: 2, message });
    if (err instanceof Error) this.span.recordException(err);
    this.span.end();
  }
}

// ═══════════════════════════════════════════════════════════════════════
// No-Op Implementations (zero overhead when telemetry is off)
// ═══════════════════════════════════════════════════════════════════════

const NO_OP_MODEL_SPAN: ModelCallSpan = {
  setResult() {},
  end() {},
  error() {},
};

const NO_OP_TOOL_SPAN: ToolCallSpan = {
  setResult() {},
  end() {},
  error() {},
};

const NO_OP_INVOKE_SPAN: InvokeSpan = {
  modelCall() { return NO_OP_MODEL_SPAN; },
  toolCall() { return NO_OP_TOOL_SPAN; },
  setResult() {},
  end() {},
  error() {},
};
