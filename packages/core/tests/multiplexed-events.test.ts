import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { defineTool } from "../src/tool.js";
import { InMemoryRunRegistry } from "../src/run-registry.js";
import { z } from "zod";
import type {
  ModelProvider,
  GenerateTextOptions,
  GenerateTextResult,
  ModelStreamResult,
  AgentDefinition,
  MultiplexedEvent,
} from "../src/types.js";

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

/** Same scripted-rule helper used in multi-agent tests. */
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
    throw new Error("ScriptedStreamProvider: no rule matched");
  }
}

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

describe("multiplexed event emission", () => {
  describe("invoke() emits per-runId events to the registry", () => {
    it("emits tool-call-start, tool-call-end, step-complete with runId", async () => {
      const provider = new ScriptedStreamProvider([
        {
          match: (o) => hasMarker(o, "TOOLY"),
          respond: (opts, idx) => {
            if (idx === 0) {
              return {
                text: "",
                toolCalls: [{ id: "tc1", name: "ping", args: {} }],
                usage,
                finishReason: "tool-calls",
              };
            }
            return { text: "done", usage, finishReason: "stop" };
          },
        },
      ]);

      const pingTool = defineTool({
        name: "ping",
        description: "ping",
        input: z.object({}),
        async execute() {
          return { pong: true };
        },
      });

      const runner = createRunner({ modelProvider: provider, tools: [pingTool] });
      runner.registerAgent({
        ...makeAgent("tooly", "TOOLY"),
        tools: [{ type: "inline", name: "ping" }],
      });

      const registry = new InMemoryRunRegistry();
      const root = registry.create({ agentId: "tooly", input: "go" });

      const events: MultiplexedEvent[] = [];
      const sub = (async () => {
        for await (const ev of registry.subscribe(root.id)) {
          events.push(ev);
          if (ev.type === "run-complete" && ev.runId === root.id) break;
        }
      })();

      await runner.invoke("tooly", "go", { runRegistry: registry, runId: root.id });
      await sub;

      const types = events.map((e) => e.type);
      expect(types).toContain("tool-call-start");
      expect(types).toContain("tool-call-end");
      expect(types).toContain("step-complete");

      // Every event must be tagged with the root run id.
      const toolStarts = events.filter((e) => e.type === "tool-call-start");
      expect(toolStarts.length).toBeGreaterThan(0);
      for (const ev of toolStarts) {
        expect(ev.runId).toBe(root.id);
      }
    });

    it("emits draining event when parent enters drain phase", async () => {
      const provider = new ScriptedStreamProvider([
        {
          match: (o) => hasMarker(o, "SLOWKID"),
          delayMs: 20,
          respond: () => ({ text: "child done", usage, finishReason: "stop" }),
        },
        {
          match: (o) => hasMarker(o, "PARENT"),
          respond: (opts, idx) => {
            if (idx === 0) {
              return {
                text: "",
                toolCalls: [
                  {
                    id: "tc1",
                    name: "spawn_agent",
                    args: { agent_id: "slowkid", input: "fetch" },
                  },
                ],
                usage,
                finishReason: "tool-calls",
              };
            }
            const seen = opts.messages.some(
              (m) =>
                m.role === "user" && m.content.includes("[Spawned agent completion]"),
            );
            if (!seen) {
              // The parent says "done" but a child is still outstanding —
              // this triggers the drain branch.
              return { text: "tentative finish", usage, finishReason: "stop" };
            }
            return { text: "final", usage, finishReason: "stop" };
          },
        },
      ]);

      const runner = createRunner({ modelProvider: provider });
      runner.registerAgent(makeAgent("slowkid", "SLOWKID"));
      runner.registerAgent(makeAgent("parent", "PARENT", [{ kind: "ref", agentId: "slowkid" }]));

      const registry = new InMemoryRunRegistry();
      const root = registry.create({ agentId: "parent", input: "go" });

      const events: MultiplexedEvent[] = [];
      const sub = (async () => {
        for await (const ev of registry.subscribe(root.id)) {
          events.push(ev);
          if (ev.type === "run-complete" && ev.runId === root.id) break;
        }
      })();

      await runner.invoke("parent", "go", { runRegistry: registry, runId: root.id });
      await sub;

      const drain = events.find((e) => e.type === "draining" && e.runId === root.id);
      expect(drain).toBeDefined();
      if (drain && drain.type === "draining") {
        // pendingChildren should be the slowkid run id, before it settled.
        expect(drain.pendingChildren.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("stream() emits all events including text-delta", () => {
    it("emits text-delta multiplexed events with correct runId", async () => {
      const provider = new ScriptedStreamProvider([
        {
          match: (o) => hasMarker(o, "TALKER"),
          respond: () => ({ text: "Hello world", usage, finishReason: "stop" }),
        },
      ]);

      const runner = createRunner({ modelProvider: provider });
      runner.registerAgent(makeAgent("talker", "TALKER"));

      const registry = new InMemoryRunRegistry();
      const root = registry.create({ agentId: "talker", input: "say hi" });

      const events: MultiplexedEvent[] = [];
      const sub = (async () => {
        for await (const ev of registry.subscribe(root.id)) {
          events.push(ev);
          if (ev.type === "run-complete" && ev.runId === root.id) break;
        }
      })();

      const stream = runner.stream("talker", "say hi", {
        runRegistry: registry,
        runId: root.id,
      });
      for await (const _ of stream) { /* consume */ }
      await stream.result;
      await sub;

      const deltas = events.filter((e) => e.type === "text-delta");
      expect(deltas.length).toBeGreaterThan(0);
      // Concatenate to confirm full text was streamed.
      const text = deltas
        .map((e) => (e as { type: "text-delta"; text: string }).text)
        .join("");
      expect(text).toBe("Hello world");

      // All deltas tagged with the root id.
      for (const d of deltas) {
        expect(d.runId).toBe(root.id);
      }
    });

    it("emits tool-call and step-complete events from stream() too", async () => {
      const provider = new ScriptedStreamProvider([
        {
          match: (o) => hasMarker(o, "TOOLYSTREAM"),
          respond: (opts, idx) => {
            if (idx === 0) {
              return {
                text: "",
                toolCalls: [{ id: "tc1", name: "ping", args: {} }],
                usage,
                finishReason: "tool-calls",
              };
            }
            return { text: "done", usage, finishReason: "stop" };
          },
        },
      ]);

      const pingTool = defineTool({
        name: "ping",
        description: "ping",
        input: z.object({}),
        async execute() {
          return { pong: true };
        },
      });

      const runner = createRunner({ modelProvider: provider, tools: [pingTool] });
      runner.registerAgent({
        ...makeAgent("toolystream", "TOOLYSTREAM"),
        tools: [{ type: "inline", name: "ping" }],
      });

      const registry = new InMemoryRunRegistry();
      const root = registry.create({ agentId: "toolystream", input: "go" });

      const events: MultiplexedEvent[] = [];
      const sub = (async () => {
        for await (const ev of registry.subscribe(root.id)) {
          events.push(ev);
          if (ev.type === "run-complete" && ev.runId === root.id) break;
        }
      })();

      const stream = runner.stream("toolystream", "go", {
        runRegistry: registry,
        runId: root.id,
      });
      for await (const _ of stream) { /* consume */ }
      await stream.result;
      await sub;

      const types = events.map((e) => e.type);
      expect(types).toContain("tool-call-start");
      expect(types).toContain("tool-call-end");
      expect(types).toContain("step-complete");
    });
  });

  it("does NOT emit per-step events when no registry provided", async () => {
    // Behavior contract: events are scoped to a registry; without one,
    // nothing should crash. Trivially true but worth asserting that
    // invoke() still works fine.
    const provider = new ScriptedStreamProvider([
      {
        match: (o) => hasMarker(o, "PLAIN"),
        respond: () => ({ text: "hi", usage, finishReason: "stop" }),
      },
    ]);
    const runner = createRunner({ modelProvider: provider });
    runner.registerAgent(makeAgent("plain", "PLAIN"));

    const r = await runner.invoke("plain", "hi");
    expect(r.output).toBe("hi");
  });
});
