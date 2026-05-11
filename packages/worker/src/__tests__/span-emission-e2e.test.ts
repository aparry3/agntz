/**
 * End-to-end span emission integration test.
 *
 * Spins up a real runner + MemoryStore + InMemoryTraceRegistry with a stub
 * model provider and verifies the full span tree shape produced by a
 * sequential manifest.
 *
 * KNOWN PRODUCTION GAP (surfaced by these tests, not fixed here):
 *   runner.invoke() calls spanEmitter.startInvoke() without forwarding
 *   ownerId — so `invoke` and `model` spans land in the store with
 *   ownerId="unknown" rather than the request's ownerId. This means
 *   traceStore.getTrace(traceId, ownerId) only returns manifest/step spans.
 *   Fix: pass ownerId via InvokeOptions and thread it into startInvoke().
 *
 *   Until that fix lands, these tests assert the tree shape via the
 *   live `seenSpans` array captured by the traceSink (which sees all spans
 *   regardless of ownerId), and verify cost via the span-end patch attrs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore, SpanEmitter, createRunner } from "@agntz/core";
import { execute } from "@agntz/manifest";
import type { Span, TraceStore } from "@agntz/core";
import type { SequentialAgentManifest } from "@agntz/manifest";
import { createExecutionContext } from "../bridge.js";
import { InMemoryTraceRegistry } from "../trace-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub model provider that never calls a real API. */
function makeStubModelProvider() {
  return {
    generateText: async () => ({
      text: "ok",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: "stop",
    }),
  } as any;
}

interface TestHarness {
  registry: InMemoryTraceRegistry;
  emitter: SpanEmitter;
  runner: ReturnType<typeof createRunner>;
  /** All span-start Span objects seen by the traceSink. */
  seenSpans: Span[];
  /** spanId → merged attributes from the span-end patch. */
  endedAttrs: Record<string, Record<string, string | number | boolean>>;
  /** Flush registry and return the root traceId from seen spans. */
  finalise(ownerId: string): Promise<string>;
}

function makeTestHarness(store: MemoryStore): TestHarness {
  const traceStore = store as unknown as TraceStore;
  const seenSpans: Span[] = [];
  const endedAttrs: Record<string, Record<string, string | number | boolean>> = {};

  const registry = new InMemoryTraceRegistry({
    store: traceStore,
    flushBatchSize: 1,
    flushIntervalMs: 50,
  });

  const emitter = new SpanEmitter({
    traceSink: (event) => {
      if (event.type === "span-start") {
        seenSpans.push(event.span);
        registry.spanStart(event.span);
      } else if (event.type === "span-end") {
        endedAttrs[event.spanId] = (event.patch.attributes ?? {}) as Record<string, string | number | boolean>;
        registry.spanEnd(event.spanId, event.patch);
      }
      // trace-done is not auto-emitted by SpanEmitter; handled manually in finalise().
    },
  });

  const runner = createRunner({
    store,
    modelProvider: makeStubModelProvider(),
  });

  async function finalise(ownerId: string): Promise<string> {
    await registry.waitForFlush();

    const rootSpan = seenSpans.find((s) => s.parentId === null);
    const traceId = rootSpan?.traceId ?? seenSpans[0]?.traceId ?? "";

    // Manually synthesise a TraceSummary so registry.traceDone() upserts it.
    // In production this would be emitted by SpanEmitter when the outermost
    // span ends (not yet implemented — another gap to address).
    registry.traceDone(traceId, ownerId, {
      traceId,
      ownerId,
      rootName: rootSpan?.name ?? "agent.manifest",
      agentId: null,
      startedAt: rootSpan?.startedAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      spanCount: seenSpans.length,
      status: "ok",
      totalTokens: 0,
      totalCostUsd: null,
    });
    await registry.waitForFlush();

    return traceId;
  }

  return { registry, emitter, runner, seenSpans, endedAttrs, finalise };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("span emission end-to-end", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("produces manifest > step > manifest(llm) > invoke > model.call hierarchy", async () => {
    const manifest: SequentialAgentManifest = {
      id: "test-seq",
      kind: "sequential",
      steps: [
        {
          agent: {
            id: "step1",
            kind: "llm",
            model: { provider: "anthropic", name: "claude-sonnet-4-6" },
            instruction: "say hi",
          },
        },
        {
          agent: {
            id: "step2",
            kind: "llm",
            model: { provider: "anthropic", name: "claude-sonnet-4-6" },
            instruction: "say bye",
          },
        },
      ],
    };

    const OWNER = "u_e2e";
    const { emitter, runner, seenSpans, finalise } = makeTestHarness(store);
    const ctx = createExecutionContext(runner, { spanEmitter: emitter, ownerId: OWNER });

    await execute(manifest, "input", ctx);
    await finalise(OWNER);

    // ── All spans are visible via seenSpans (traceSink sees all, regardless of ownerId) ──
    expect(seenSpans.length).toBeGreaterThan(0);

    const byKind = seenSpans.reduce(
      (acc, s) => {
        (acc[s.kind] ??= []).push(s);
        return acc;
      },
      {} as Record<string, Span[]>,
    );

    // Root sequential manifest span
    expect(byKind["manifest"]).toBeDefined();
    // 1 sequential root + 2 inline llm manifests (one per step)
    expect(byKind["manifest"]!.length).toBe(3);

    // Two step spans — one per sequential step — both children of the sequential manifest
    expect(byKind["step"]?.length).toBe(2);

    // Two invoke spans — one per LLM agent invocation
    expect(byKind["invoke"]?.length).toBe(2);

    // Two model.call spans
    expect(byKind["model"]?.length).toBe(2);

    // Sequential manifest span is the trace root (no parent)
    const seqManifestSpan = byKind["manifest"]!.find((s) => s.parentId === null);
    expect(seqManifestSpan).toBeDefined();

    // Step spans are direct children of the sequential manifest
    for (const stepSpan of byKind["step"]!) {
      expect(stepSpan.parentId).toBe(seqManifestSpan!.spanId);
    }

    // Each step has a child llm manifest span
    const stepIds = new Set(byKind["step"]!.map((s) => s.spanId));
    const llmManifestSpans = byKind["manifest"]!.filter((s) => s.parentId !== null);
    for (const llmManifest of llmManifestSpans) {
      expect(stepIds.has(llmManifest.parentId ?? "")).toBe(true);
    }

    // Invoke spans are children of an llm manifest span
    const llmManifestIds = new Set(llmManifestSpans.map((s) => s.spanId));
    for (const invokeSpan of byKind["invoke"]!) {
      expect(llmManifestIds.has(invokeSpan.parentId ?? "")).toBe(true);
    }

    // Model spans are children of invoke spans
    const invokeIds = new Set(byKind["invoke"]!.map((s) => s.spanId));
    for (const modelSpan of byKind["model"]!) {
      expect(invokeIds.has(modelSpan.parentId ?? "")).toBe(true);
    }

    // NOTE: invoke + model spans have ownerId="unknown" (production gap — runner
    // does not forward ownerId to startInvoke). Only manifest + step spans have
    // ownerId=OWNER and persist to the store under OWNER's namespace.
    const traceStore = store as unknown as TraceStore;
    const traceId = seqManifestSpan!.traceId;
    const storedSpans = await traceStore.getTrace(traceId, OWNER);
    // manifest(sequential) + step×2 + manifest(llm)×2 = 5 owner-scoped spans
    expect(storedSpans.length).toBe(5);
    expect(storedSpans.every((s) => s.ownerId === OWNER)).toBe(true);
  });

  it("model.call span carries agent.cost_usd attribute when the model has a known rate", async () => {
    const manifest: SequentialAgentManifest = {
      id: "test-cost",
      kind: "sequential",
      steps: [
        {
          agent: {
            id: "step1",
            kind: "llm",
            model: { provider: "anthropic", name: "claude-haiku-4-5" },
            instruction: "ping",
          },
        },
      ],
    };

    const COST_OWNER = "u_cost";
    const { emitter, runner, seenSpans, endedAttrs, finalise } = makeTestHarness(store);
    const ctx = createExecutionContext(runner, { spanEmitter: emitter, ownerId: COST_OWNER });

    await execute(manifest, "in", ctx);
    await finalise(COST_OWNER);

    // Find the model span from live seenSpans (not from store — store won't have
    // it because ownerId="unknown" due to the production gap noted above).
    const modelSpan = seenSpans.find((s) => s.kind === "model");
    expect(modelSpan).toBeDefined();

    // cost_usd is set via setModelResult() before closeSpan(), so it appears
    // in the span-end patch's attributes (not in span.costUsd, which is set
    // only at span-start time by stateToSpan before setResult is called).
    const attrs = endedAttrs[modelSpan!.spanId];
    expect(attrs).toBeDefined();

    const costAttr = attrs["agent.cost_usd"];
    expect(typeof costAttr).toBe("number");
    // anthropic/claude-haiku-4-5: 10 prompt × $1/1M + 5 completion × $5/1M = $0.000035
    expect(costAttr as number).toBeGreaterThan(0);
    expect(costAttr as number).toBeLessThan(0.001);
  });
});
