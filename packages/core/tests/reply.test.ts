import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { InMemoryRunRegistry } from "../src/run-registry.js";
import { MemoryStore } from "../src/stores/memory.js";
import type {
  GenerateTextOptions,
  GenerateTextResult,
  ModelProvider,
  MultiplexedEvent,
} from "../src/types.js";

/**
 * Deterministic provider. Returns each entry of `responses` in order; stores
 * every received options object for later inspection. Identical to the patterns
 * in runner.test.ts and runner-skills.test.ts.
 */
class MockModelProvider implements ModelProvider {
  private responses: GenerateTextResult[];
  private callIndex = 0;
  public calls: GenerateTextOptions[] = [];

  constructor(responses: GenerateTextResult[]) {
    this.responses = responses;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push(options);
    const r = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex++;
    return r;
  }
}

function replyCall(id: string, text: string): GenerateTextResult {
  return {
    text: "",
    toolCalls: [{ id, name: "reply", args: { text } }],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: "tool-calls",
  };
}

function finalText(text: string): GenerateTextResult {
  return {
    text,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    finishReason: "stop",
  };
}

describe("reply tool", () => {
  it("does NOT register a reply tool when agent.reply is unset", async () => {
    const provider = new MockModelProvider([finalText("done")]);
    const runner = createRunner({ modelProvider: provider });
    runner.registerAgent(
      defineAgent({
        id: "no-reply",
        name: "No Reply",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
      }),
    );

    const result = await runner.invoke("no-reply", "go");

    expect(result.output).toBe("done");
    expect(result.replies).toBeUndefined();
    const toolNames = (provider.calls[0].tools ?? []).map((t) => t.name);
    expect(toolNames).not.toContain("reply");
  });

  it("registers a reply tool when agent.reply: true", async () => {
    const provider = new MockModelProvider([finalText("done")]);
    const runner = createRunner({ modelProvider: provider });
    runner.registerAgent(
      defineAgent({
        id: "with-reply",
        name: "With Reply",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    await runner.invoke("with-reply", "go");

    const toolNames = (provider.calls[0].tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("reply");
  });

  it("collects reply, persists assistant row, returns { delivered: true }", async () => {
    const provider = new MockModelProvider([
      replyCall("tc1", "still thinking..."),
      finalText("here's my answer"),
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.replies).toBeDefined();
    expect(result.replies).toHaveLength(1);
    expect(result.replies![0].text).toBe("still thinking...");
    expect(result.replies![0].sessionId).toBe(result.sessionId);
    expect(result.replies![0].runId).toBeDefined();

    // The reply tool returned { delivered: true } to the model
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("reply");
    expect(result.toolCalls[0].output).toEqual({ delivered: true });

    // Session has: user + reply (assistant) + final (assistant) = 3 messages
    const msgs = await store.getMessages(result.sessionId);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("still thinking...");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[2].content).toBe("here's my answer");
  });

  it("rate-limits at maxPerRun=3 — fourth call returns rate_limited", async () => {
    // Five attempted replies; only the first three should land in the collector.
    const provider = new MockModelProvider([
      replyCall("tc1", "msg 1"),
      replyCall("tc2", "msg 2"),
      replyCall("tc3", "msg 3"),
      replyCall("tc4", "msg 4"),
      replyCall("tc5", "msg 5"),
      finalText("done"),
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: { maxPerRun: 3 },
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.replies).toHaveLength(3);
    // Calls 4 and 5 returned { delivered: false, reason: "rate_limited" }.
    const outputs = result.toolCalls.map((c) => c.output);
    expect(outputs[0]).toEqual({ delivered: true });
    expect(outputs[1]).toEqual({ delivered: true });
    expect(outputs[2]).toEqual({ delivered: true });
    expect(outputs[3]).toEqual({ delivered: false, reason: "rate_limited", maxPerRun: 3 });
    expect(outputs[4]).toEqual({ delivered: false, reason: "rate_limited", maxPerRun: 3 });
  });

  it("dedupes identical text within the default 100ms window", async () => {
    // Two replies with the same text back-to-back.
    const provider = new MockModelProvider([
      replyCall("tc1", "same"),
      replyCall("tc2", "same"),
      finalText("done"),
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.replies).toHaveLength(1);
    expect(result.toolCalls[0].output).toEqual({ delivered: true });
    expect(result.toolCalls[1].output).toEqual({ delivered: false, reason: "duplicate" });
  });

  it("two replies + final output → replies.length===2, session has 4 rows (user + 2 replies + final)", async () => {
    const provider = new MockModelProvider([
      replyCall("tc1", "thinking 1"),
      replyCall("tc2", "thinking 2"),
      finalText("final answer"),
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.output).toBe("final answer");
    expect(result.replies).toHaveLength(2);

    const msgs = await store.getMessages(result.sessionId);
    expect(msgs.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: "thinking 1" },
      { role: "assistant", content: "thinking 2" },
      { role: "assistant", content: "final answer" },
    ]);
  });

  it("two replies + empty final → replies.length===2, session has 3 rows (no empty assistant)", async () => {
    const provider = new MockModelProvider([
      replyCall("tc1", "thinking 1"),
      replyCall("tc2", "thinking 2"),
      finalText(""), // Empty final response.
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.output).toBe("");
    expect(result.replies).toHaveLength(2);

    const msgs = await store.getMessages(result.sessionId);
    // user + 2 replies — no trailing empty assistant row.
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].content).toBe("thinking 1");
    expect(msgs[2].content).toBe("thinking 2");
  });

  it("honors reply: { maxPerRun: 5 }", async () => {
    // Six attempted replies; only the first five should land.
    const calls: GenerateTextResult[] = [];
    for (let i = 1; i <= 6; i++) calls.push(replyCall(`tc${i}`, `msg ${i}`));
    calls.push(finalText("done"));

    const provider = new MockModelProvider(calls);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: { maxPerRun: 5 },
      }),
    );

    const result = await runner.invoke("agent", "go", { userId: "u1" });

    expect(result.replies).toHaveLength(5);
    expect(result.toolCalls[5].output).toEqual({
      delivered: false,
      reason: "rate_limited",
      maxPerRun: 5,
    });
  });

  it("emits a `reply` MultiplexedEvent on RunRegistry", async () => {
    const provider = new MockModelProvider([
      replyCall("tc1", "intermediate ping"),
      finalText("done"),
    ]);
    const store = new MemoryStore().forUser("u1");
    const runner = createRunner({ modelProvider: provider, store });
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 60_000 });
    runner.registerAgent(
      defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        reply: true,
      }),
    );

    // Pre-allocate a session so the registry knows the session→run mapping
    // before we subscribe. Then run the invocation to completion and replay
    // the buffered events via subscribe(sinceSeq=0).
    const sessionId = "sess-reply-event";
    const result = await runner.invoke("agent", "go", {
      userId: "u1",
      sessionId,
      runRegistry: registry,
    });

    // The registry indexes the run by sessionId at create() time and clears
    // it on terminal — but with gracePeriodMs > 0 the run record (and its
    // rootId) is still recoverable via the run's own rootId reference. We
    // find it by scanning the registry's pending children path, but the
    // simplest robust approach: replay against `result.sessionId`'s last
    // known run id stored in the registry. Since the run is terminal,
    // `findActiveBySession` returns undefined, so we iterate all subscribed
    // roots in the replay buffer instead.
    //
    // The registry doesn't expose a "list rootIds" API, so we cheat: the
    // run-complete event was emitted on the rootId, and the result.replies[0]
    // carries the runId. Top-level invokes have runId === rootId, so we
    // subscribe to result.replies[0].runId.
    expect(result.replies).toBeDefined();
    expect(result.replies).toHaveLength(1);
    const rootId = result.replies![0].runId;

    const events: MultiplexedEvent[] = [];
    for await (const ev of registry.subscribe(rootId, 0)) {
      events.push(ev);
      if (
        ev.type === "run-complete" ||
        ev.type === "run-error" ||
        ev.type === "run-cancelled"
      ) {
        break;
      }
    }

    const replyEvents = events.filter((e) => e.type === "reply");
    expect(replyEvents).toHaveLength(1);
    const rep = replyEvents[0] as Extract<MultiplexedEvent, { type: "reply" }>;
    expect(rep.text).toBe("intermediate ping");
    expect(rep.sessionId).toBe(sessionId);
    expect(rep.runId).toBe(rootId);
    expect(typeof rep.seq).toBe("number");
    expect(rep.seq).toBeGreaterThan(0);
  });
});
