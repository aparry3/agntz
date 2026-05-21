import { describe, it, expect } from "vitest";
import { SpanEmitter } from "../src/telemetry.js";
import type { TraceLiveEvent } from "../src/types.js";
import { computeCost } from "../src/model-pricing.js";

function withEmitter(): { emitter: SpanEmitter; events: TraceLiveEvent[] } {
  const events: TraceLiveEvent[] = [];
  const emitter = new SpanEmitter({ traceSink: (e) => events.push(e) });
  return { emitter, events };
}

describe("SpanEmitter", () => {
  it("startInvoke emits span-start with traceId and no parent", () => {
    const { emitter, events } = withEmitter();
    const s = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    s.end();
    expect(events).toHaveLength(2);
    const start = events[0] as { type: string; span: { traceId: string; parentId: string | null; kind: string } };
    expect(start.type).toBe("span-start");
    expect(start.span.kind).toBe("invoke");
    expect(start.span.parentId).toBeNull();
    expect(start.span.traceId).toMatch(/^tr_/);
  });

  it("nested manifest > invoke threads parentId and shares traceId", () => {
    const { emitter, events } = withEmitter();
    const m = emitter.startManifest({ ownerId: "u1", agentId: "a1", kind: "llm" });
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    inv.end();
    m.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { traceId: string; parentId: string | null; spanId: string; kind: string } }>;
    expect(starts).toHaveLength(2);
    expect(starts[0].span.kind).toBe("manifest");
    expect(starts[1].span.kind).toBe("invoke");
    expect(starts[1].span.parentId).toBe(starts[0].span.spanId);
    expect(starts[1].span.traceId).toBe(starts[0].span.traceId);
  });

  it("model.call and tool.execute spans nest under invoke as explicit children", () => {
    const { emitter, events } = withEmitter();
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    const mc = inv.modelCall({ model: "claude-sonnet-4-6", step: 1 });
    mc.end();
    const tc = inv.toolCall({ toolName: "read_file", toolCallId: "tc_1" });
    tc.end();
    inv.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { kind: string; parentId: string | null; spanId: string } }>;
    expect(starts.map((s) => s.span.kind)).toEqual(["invoke", "model", "tool"]);
    expect(starts[1].span.parentId).toBe(starts[0].span.spanId);
    expect(starts[2].span.parentId).toBe(starts[0].span.spanId);
  });

  it("span-end carries patch with status, duration, error", () => {
    const { emitter, events } = withEmitter();
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    inv.error(new Error("boom"));
    const end = events.find((e) => e.type === "span-end") as { type: string; patch: { status: string; error: string | null; durationMs: number | null } };
    expect(end.patch.status).toBe("error");
    expect(end.patch.error).toBe("boom");
    expect(end.patch.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("with no traceSink and no OTel, emit() calls are no-ops (no throw)", () => {
    const emitter = new SpanEmitter();
    expect(() => {
      const s = emitter.startInvoke({ agentId: "a", invocationId: "i", model: "m", ownerId: "u1" });
      s.end();
    }).not.toThrow();
  });

  it("ownerId is preserved through nested spans", () => {
    const { emitter, events } = withEmitter();
    const m = emitter.startManifest({ ownerId: "u_special", agentId: "a", kind: "llm" });
    const inv = emitter.startInvoke({ agentId: "a", invocationId: "i", model: "m", ownerId: "u_special" });
    inv.end();
    m.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { ownerId: string } }>;
    for (const s of starts) expect(s.span.ownerId).toBe("u_special");
  });

  it("uses injected traceId for the root span when config.traceId is set", () => {
    const events: TraceLiveEvent[] = [];
    const emitter = new SpanEmitter({
      traceSink: (e) => events.push(e),
      traceId: "tr_externally_minted",
    });
    const m = emitter.startManifest({ ownerId: "u1", agentId: "a", kind: "llm" });
    const inv = emitter.startInvoke({ agentId: "a", invocationId: "i", model: "m", ownerId: "u1" });
    inv.end();
    m.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { traceId: string } }>;
    expect(starts).toHaveLength(2);
    for (const s of starts) expect(s.span.traceId).toBe("tr_externally_minted");
  });
});

describe("computeCost", () => {
  it("returns USD cost for known models", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      "anthropic",
      "claude-sonnet-4-6"
    );
    expect(cost).toBe(3.00);
  });

  it("returns null for unknown models", () => {
    const cost = computeCost(
      { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
      "unknown",
      "model"
    );
    expect(cost).toBeNull();
  });

  it("computes correctly for mixed token counts", () => {
    // claude-haiku-4-5: 1.00/M input, 5.00/M output
    const cost = computeCost(
      { promptTokens: 500_000, completionTokens: 100_000, totalTokens: 600_000 },
      "anthropic",
      "claude-haiku-4-5"
    );
    expect(cost).toBe(0.5 + 0.5); // 0.5 input + 0.5 output = 1.0 USD
  });
});
