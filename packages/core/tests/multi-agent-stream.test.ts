import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { InMemoryRunRegistry } from "../src/run-registry.js";
import type {
  ModelProvider,
  GenerateTextOptions,
  GenerateTextResult,
  ModelStreamResult,
  AgentDefinition,
  MultiplexedEvent,
  StreamEvent,
} from "../src/types.js";

/**
 * Scripted streaming provider that supports both generateText and streamText
 * with per-rule matching, like ScriptedModelProvider in multi-agent.test.ts.
 *
 * Splits text into 5-char chunks to simulate token streaming.
 */
interface Rule {
  match: (opts: GenerateTextOptions) => boolean;
  respond: (opts: GenerateTextOptions, callIdx: number) => GenerateTextResult;
  delayMs?: number;
}

class ScriptedStreamProvider implements ModelProvider {
  public callsByRule = new Map<number, number>();
  public allCalls: GenerateTextOptions[] = [];

  constructor(private rules: Rule[]) {}

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    return this.dispatch(options);
  }

  async streamText(options: GenerateTextOptions): Promise<ModelStreamResult> {
    const response = await this.dispatch(options);
    const text = response.text;
    const chunks = text.match(/.{1,5}/g) ?? (text ? [text] : []);

    async function* textStream() {
      for (const c of chunks) yield c;
    }

    return {
      textStream: textStream(),
      toolCalls: Promise.resolve(response.toolCalls ?? []),
      usage: Promise.resolve(response.usage),
      finishReason: Promise.resolve(response.finishReason),
      async toResult(): Promise<GenerateTextResult> {
        return response;
      },
    };
  }

  private async dispatch(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.allCalls.push(options);
    for (let i = 0; i < this.rules.length; i++) {
      if (this.rules[i].match(options)) {
        const c = this.callsByRule.get(i) ?? 0;
        this.callsByRule.set(i, c + 1);
        if (this.rules[i].delayMs) {
          await new Promise((r) => setTimeout(r, this.rules[i].delayMs));
        }
        return this.rules[i].respond(options, c);
      }
    }
    throw new Error(
      `ScriptedStreamProvider: no rule matched. messages:\n${options.messages
        .map((m) => `  ${m.role}: ${m.content.slice(0, 80)}`)
        .join("\n")}`,
    );
  }
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

function makeAgent(
  id: string,
  systemMarker: string,
  spawnable?: AgentDefinition["spawnable"],
): AgentDefinition {
  return defineAgent({
    id,
    name: id,
    systemPrompt: `MARKER:${systemMarker}\nYou are agent ${id}.`,
    model: { provider: "openai", name: "test-model" },
    spawnable,
  });
}

function hasMarker(opts: GenerateTextOptions, marker: string): boolean {
  return opts.messages.some(
    (m) => m.role === "system" && m.content.includes(`MARKER:${marker}`),
  );
}

function spawnCall(toolUseId: string, agentId: string, input: string): GenerateTextResult {
  return {
    text: "",
    toolCalls: [
      {
        id: toolUseId,
        name: "spawn_agent",
        args: { agent_id: agentId, input },
      },
    ],
    usage,
    finishReason: "tool-calls",
  };
}

describe("multi-agent spawning via stream()", () => {
  it("stream() supports spawn_agent and drains pending children", async () => {
    const provider = new ScriptedStreamProvider([
      // Researcher: emits text & stops.
      {
        match: (o) => hasMarker(o, "RESEARCHER"),
        respond: () => ({
          text: "the answer is 42",
          usage,
          finishReason: "stop",
        }),
      },
      // Parent: spawn → think → final.
      {
        match: (o) => hasMarker(o, "PARENT"),
        respond: (opts, callIdx) => {
          if (callIdx === 0) return spawnCall("tc1", "researcher", "what is the answer");
          const seenNotice = opts.messages.some(
            (m) => m.role === "user" && m.content.includes("[Spawned agent completion]"),
          );
          if (!seenNotice) {
            return { text: "(thinking...)", usage, finishReason: "stop" };
          }
          return { text: "FINAL: I learned the answer is 42", usage, finishReason: "stop" };
        },
      },
    ]);

    const runner = createRunner({ modelProvider: provider });
    const registry = new InMemoryRunRegistry();

    runner.registerAgent(makeAgent("researcher", "RESEARCHER"));
    runner.registerAgent(
      makeAgent("parent", "PARENT", [{ kind: "ref", agentId: "researcher" }]),
    );

    const stream = runner.stream("parent", "find the answer", {
      runRegistry: registry,
    });

    const events: StreamEvent[] = [];
    for await (const ev of stream) {
      events.push(ev);
    }

    const result = await stream.result;
    expect(result.output).toBe("FINAL: I learned the answer is 42");
    // The child must have been spawned & finished
    expect(provider.callsByRule.get(0)).toBe(1);
    // Parent should have streamed at least 2 loop iterations
    expect((provider.callsByRule.get(1) ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("stream() forbids termination while children outstanding", async () => {
    const provider = new ScriptedStreamProvider([
      {
        match: (o) => hasMarker(o, "SLOW_CHILD"),
        delayMs: 30,
        respond: () => ({ text: "slow answer", usage, finishReason: "stop" }),
      },
      {
        match: (o) => hasMarker(o, "IMPATIENT_PARENT"),
        respond: (opts, callIdx) => {
          if (callIdx === 0) return spawnCall("tc1", "slow", "go");
          const seenNotice = opts.messages.some(
            (m) => m.role === "user" && m.content.includes("[Spawned agent completion]"),
          );
          if (!seenNotice) {
            return { text: "I'm done now (incorrectly)", usage, finishReason: "stop" };
          }
          return { text: "now I have the slow answer", usage, finishReason: "stop" };
        },
      },
    ]);

    const runner = createRunner({ modelProvider: provider });
    const registry = new InMemoryRunRegistry();

    runner.registerAgent(makeAgent("slow", "SLOW_CHILD"));
    runner.registerAgent(
      makeAgent("parent", "IMPATIENT_PARENT", [{ kind: "ref", agentId: "slow" }]),
    );

    const stream = runner.stream("parent", "go", { runRegistry: registry });
    for await (const _ of stream) { /* consume */ }
    const result = await stream.result;

    // The parent's first "I'm done" must NOT have terminated.
    expect(result.output).toBe("now I have the slow answer");
  });

  it("stream() registers spawn_agent + check_agents when registry provided", async () => {
    const provider = new ScriptedStreamProvider([
      {
        match: (o) => hasMarker(o, "PARENT_WITH_REG"),
        respond: (opts) => {
          const toolNames = (opts.tools ?? []).map((t) => t.name).sort();
          return {
            text: `tools=${toolNames.join(",")}`,
            usage,
            finishReason: "stop",
          };
        },
      },
    ]);

    const runner = createRunner({ modelProvider: provider });
    const registry = new InMemoryRunRegistry();

    runner.registerAgent(makeAgent("researcher", "RESEARCHER"));
    runner.registerAgent(
      makeAgent("parent", "PARENT_WITH_REG", [{ kind: "ref", agentId: "researcher" }]),
    );

    const stream = runner.stream("parent", "go", { runRegistry: registry });
    for await (const _ of stream) { /* consume */ }
    const result = await stream.result;

    expect(result.output).toBe("tools=check_agents,spawn_agent");
  });

  it("stream() does NOT register spawn_agent without a runRegistry", async () => {
    const provider = new ScriptedStreamProvider([
      {
        match: (o) => hasMarker(o, "PARENT_NO_REG"),
        respond: (opts) => {
          const toolNames = (opts.tools ?? []).map((t) => t.name);
          return {
            text: `tools=${toolNames.join(",")}`,
            usage,
            finishReason: "stop",
          };
        },
      },
    ]);

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(makeAgent("researcher", "RESEARCHER"));
    runner.registerAgent(
      makeAgent("parent", "PARENT_NO_REG", [{ kind: "ref", agentId: "researcher" }]),
    );

    const stream = runner.stream("parent", "go"); // no runRegistry
    for await (const _ of stream) { /* consume */ }
    const result = await stream.result;

    expect(result.output).toBe("tools=");
  });

  it("stream() materializes a top-level Run and notifies completion", async () => {
    const provider = new ScriptedStreamProvider([
      {
        match: (o) => hasMarker(o, "SOLO"),
        respond: () => ({ text: "done", usage, finishReason: "stop" }),
      },
    ]);

    const runner = createRunner({ modelProvider: provider });
    const registry = new InMemoryRunRegistry();
    runner.registerAgent(makeAgent("solo", "SOLO"));

    // Pre-create a root run via the registry so we can subscribe to its rootId.
    const root = registry.create({ agentId: "solo", input: "hello" });

    // Subscribe before stream starts so we observe events live.
    const events: MultiplexedEvent[] = [];
    const sub = (async () => {
      for await (const ev of registry.subscribe(root.id)) {
        events.push(ev);
        if (ev.type === "run-complete" && ev.runId === root.id) break;
      }
    })();

    const stream = runner.stream("solo", "hello", {
      runRegistry: registry,
      runId: root.id,
    });
    for await (const _ of stream) { /* consume */ }
    await stream.result;
    await sub;

    // Should have at least run-spawn + run-complete for the root id.
    const runSpawn = events.find((e) => e.type === "run-spawn" && e.runId === root.id);
    expect(runSpawn).toBeDefined();
    const runComplete = events.find((e) => e.type === "run-complete" && e.runId === root.id);
    expect(runComplete).toBeDefined();
  });

  it("stream() notifies registry on failure", async () => {
    const provider: ModelProvider = {
      async generateText(): Promise<GenerateTextResult> {
        throw new Error("boom");
      },
      async streamText(): Promise<ModelStreamResult> {
        throw new Error("boom");
      },
    };

    const runner = createRunner({ modelProvider: provider });
    const registry = new InMemoryRunRegistry();
    runner.registerAgent(makeAgent("fail", "FAIL"));

    const root = registry.create({ agentId: "fail", input: "go" });

    const events: MultiplexedEvent[] = [];
    const sub = (async () => {
      for await (const ev of registry.subscribe(root.id)) {
        events.push(ev);
        if (
          ev.runId === root.id &&
          (ev.type === "run-error" || ev.type === "run-cancelled" || ev.type === "run-complete")
        ) {
          break;
        }
      }
    })();

    const stream = runner.stream("fail", "go", {
      runRegistry: registry,
      runId: root.id,
    });
    let threw = false;
    try {
      for await (const _ of stream) { /* consume */ }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    await sub;

    const runError = events.find((e) => e.type === "run-error" && e.runId === root.id);
    expect(runError).toBeDefined();
  });
});
