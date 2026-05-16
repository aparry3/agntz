import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { InMemoryRunRegistry } from "../src/run-registry.js";
import { MemoryStore } from "../src/stores/memory.js";
import type {
  ModelProvider,
  GenerateTextOptions,
  GenerateTextResult,
} from "../src/types.js";

/**
 * Mock provider with optional artificial delay so we can interleave
 * concurrent invokes deterministically.
 */
class DelayedMockProvider implements ModelProvider {
  public calls: GenerateTextOptions[] = [];
  constructor(
    private respond: (
      opts: GenerateTextOptions,
      callIdx: number,
    ) => GenerateTextResult,
    private delayMs = 0,
  ) {}

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const idx = this.calls.length;
    this.calls.push(options);
    if (this.delayMs > 0) {
      await sleepRespectingAbort(this.delayMs, options.signal);
    }
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }
    return this.respond(options, idx);
  }
}

function sleepRespectingAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => resolve(), ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    }
  });
}

function mockResponse(text: string): GenerateTextResult {
  return {
    text,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: "stop",
  };
}

function makeRunner(provider: ModelProvider) {
  const store = new MemoryStore();
  const runner = createRunner({ modelProvider: provider, store });
  runner.registerAgent(
    defineAgent({
      id: "chat",
      name: "Chat",
      systemPrompt: "You are a chat agent.",
      model: { provider: "openai", name: "gpt-5.4-mini" },
    }),
  );
  return { runner, store };
}

describe("session always-return-id", () => {
  it("invoke without sessionId returns a fresh sessionId and persists history", async () => {
    const provider = new DelayedMockProvider(() => mockResponse("hi back"));
    const { runner, store } = makeRunner(provider);

    const first = await runner.invoke("chat", "hello");
    expect(typeof first.sessionId).toBe("string");
    expect(first.sessionId.length).toBeGreaterThan(0);
    expect(first.output).toBe("hi back");

    // Session row exists.
    const sessions = await store.listSessions();
    expect(sessions.some((s) => s.sessionId === first.sessionId)).toBe(true);

    // Messages were persisted under that id.
    const messages = await store.getMessages(first.sessionId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("hello");
    expect(messages[1].content).toBe("hi back");
  });

  it("second invoke with returned sessionId loads history", async () => {
    const provider = new DelayedMockProvider((_, i) =>
      mockResponse(i === 0 ? "first" : "second"),
    );
    const { runner } = makeRunner(provider);

    const first = await runner.invoke("chat", "msg one");
    const second = await runner.invoke("chat", "msg two", {
      sessionId: first.sessionId,
    });

    expect(second.sessionId).toBe(first.sessionId);
    // The second model call must have seen the prior conversation.
    const secondCallMessages = provider.calls[1].messages;
    const userMessages = secondCallMessages.filter((m) => m.role === "user");
    expect(userMessages.map((m) => m.content)).toContain("msg one");
    expect(userMessages.map((m) => m.content)).toContain("msg two");
  });

  it("getOrCreateSession is a no-op when the session already exists", async () => {
    const provider = new DelayedMockProvider(() => mockResponse("ok"));
    const { runner, store } = makeRunner(provider);

    await store.getOrCreateSession("sess_pre");
    const result = await runner.invoke("chat", "hi", { sessionId: "sess_pre" });
    expect(result.sessionId).toBe("sess_pre");
  });
});

describe("cancel-and-replace concurrency", () => {
  it("two concurrent invokes on the same session: the first is cancelled, the second survives", async () => {
    const provider = new DelayedMockProvider(
      (opts, idx) => mockResponse(`out_${idx}`),
      200,
    );
    const { runner, store } = makeRunner(provider);
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 0 });

    const sessionId = "sess_race";

    // Kick off invoke A first.
    const aPromise = runner.invoke("chat", "from A", {
      sessionId,
      runRegistry: registry,
    });
    // Give A's run-creation a chance to register in the session index, then
    // start B. B must observe A as active, cancel it, and proceed.
    await new Promise((r) => setTimeout(r, 20));
    const bPromise = runner.invoke("chat", "from B", {
      sessionId,
      runRegistry: registry,
    });

    const settled = await Promise.allSettled([aPromise, bPromise]);
    const survivors = settled.filter((s) => s.status === "fulfilled");
    expect(survivors.length).toBe(1);

    // Only B's user message should remain in the session history. A was
    // cancelled before persistence, and the runner's signal-aborted guard
    // suppresses the persist for A.
    const messages = await store.getMessages(sessionId);
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.map((m) => m.content)).toEqual(["from B"]);

    // The cancelled invocation should be auditable in the log store with
    // status === "cancelled".
    const logs = await store.getLogs();
    const cancelled = logs.find((l) => l.status === "cancelled");
    const completed = logs.find((l) => l.status === "completed");
    expect(cancelled).toBeDefined();
    expect(completed).toBeDefined();
    expect(cancelled!.sessionId).toBe(sessionId);
    expect(completed!.sessionId).toBe(sessionId);
  });

  it("TOCTOU: 5 simultaneous invokes on the same sessionId all settle without errors or orphans", async () => {
    const provider = new DelayedMockProvider(
      (_, idx) => mockResponse(`out_${idx}`),
      40,
    );
    const { runner } = makeRunner(provider);
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 0 });

    const sessionId = "sess_storm";
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        runner
          .invoke("chat", `req_${i}`, { sessionId, runRegistry: registry })
          // Swallow rejections from cancelled invocations — we only want to
          // assert that the whole storm settles cleanly without throwing
          // from the registry or leaking state.
          .catch((err) => ({ error: err })),
      );
      // Yield so each acquisition tries to grab the session lock in turn.
      await Promise.resolve();
    }
    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);

    // After all settle, no run should remain indexed against this session.
    expect(registry.findActiveBySession(sessionId)).toBeUndefined();
  });

  it("findActiveBySession returns the in-flight runId and clears on terminal", async () => {
    const provider = new DelayedMockProvider(() => mockResponse("done"), 100);
    const { runner } = makeRunner(provider);
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 0 });

    const sessionId = "sess_lookup";
    const p = runner.invoke("chat", "ping", {
      sessionId,
      runRegistry: registry,
    });

    // Give the runner enough time to walk through ensureMCP/resolveAgent/
    // getOrCreateSession/acquireSessionLock and register the Run.
    await new Promise((r) => setTimeout(r, 20));

    const activeRunId = registry.findActiveBySession(sessionId);
    expect(activeRunId).toBeDefined();
    expect(typeof activeRunId).toBe("string");

    await p;

    // After terminal, the index is cleared.
    expect(registry.findActiveBySession(sessionId)).toBeUndefined();
  });

  it("acquireSessionLock serialises with FIFO ordering", async () => {
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 0 });
    const order: number[] = [];

    const sessionId = "sess_lock";
    const make = async (idx: number, holdMs: number) => {
      const release = await registry.acquireSessionLock(sessionId);
      order.push(idx);
      await new Promise((r) => setTimeout(r, holdMs));
      release();
    };

    await Promise.all([make(1, 20), make(2, 5), make(3, 5)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("waitForTerminal resolves immediately for already-terminal runs and on transition for active runs", async () => {
    const provider = new DelayedMockProvider(() => mockResponse("done"), 100);
    const { runner } = makeRunner(provider);
    const registry = new InMemoryRunRegistry({ gracePeriodMs: 0 });

    const sessionId = "sess_wait";
    const p = runner.invoke("chat", "ping", {
      sessionId,
      runRegistry: registry,
    });
    await new Promise((r) => setTimeout(r, 20));

    const activeRunId = registry.findActiveBySession(sessionId);
    expect(activeRunId).toBeDefined();

    // Awaiting terminal should resolve once the invoke completes.
    const waitPromise = registry.waitForTerminal(activeRunId!);
    await p;
    await waitPromise; // resolves without throwing

    // Calling waitForTerminal again on a terminal/unknown id resolves immediately.
    await registry.waitForTerminal(activeRunId!);
    await registry.waitForTerminal("unknown-run-id");
  });
});
