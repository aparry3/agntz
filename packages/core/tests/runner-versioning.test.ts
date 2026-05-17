import { describe, it, expect, beforeEach } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { MemoryStore } from "../src/stores/memory.js";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  InvalidAgentRefError,
} from "../src/errors.js";
import type {
  AgentDefinition,
  GenerateTextOptions,
  GenerateTextResult,
  ModelProvider,
} from "../src/types.js";

class StubProvider implements ModelProvider {
  async generateText(_opts: GenerateTextOptions): Promise<GenerateTextResult> {
    return {
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop",
    };
  }
}

function makeAgent(name: string): AgentDefinition {
  return defineAgent({
    id: "reviewer",
    name,
    systemPrompt: `prompt-${name}`,
    model: { provider: "openai", name: "gpt-5.4-mini" },
  });
}

async function putAndCapture(
  store: MemoryStore,
  agent: AgentDefinition,
): Promise<string> {
  await store.putAgent(agent);
  const versions = await store.listAgentVersions(agent.id);
  return versions[0].createdAt;
}

describe("Runner reference syntax", () => {
  let store: MemoryStore;
  let runner: ReturnType<typeof createRunner>;

  beforeEach(() => {
    store = new MemoryStore();
    runner = createRunner({
      modelProvider: new StubProvider(),
      agentStore: store,
    });
  });

  it("resolves bare id to the activated version", async () => {
    const v1Ts = await putAndCapture(store, makeAgent("v1"));
    // tiny delay so v2 has a strictly later timestamp
    await new Promise((r) => setTimeout(r, 5));
    await putAndCapture(store, makeAgent("v2"));

    // putAgent auto-activates, so the activated version is v2 (newest).
    const r1 = await runner.invoke("reviewer", "hello");
    expect(r1.output).toBe("ok");

    // Re-pin to v1 — bare id should now resolve to v1.
    await store.activateAgentVersion("reviewer", v1Ts);
    const agent = await store.getAgent("reviewer");
    expect(agent?.name).toBe("v1");
  });

  it("@latest ignores activation and returns the newest by created_at", async () => {
    const v1Ts = await putAndCapture(store, makeAgent("v1"));
    await new Promise((r) => setTimeout(r, 5));
    await putAndCapture(store, makeAgent("v2"));

    // Pin to v1 — bare id resolves to v1, @latest still resolves to v2.
    await store.activateAgentVersion("reviewer", v1Ts);

    expect((await store.getAgent("reviewer"))?.name).toBe("v1");

    // resolveAgentRef is the public helper that lets us assert resolution
    // without driving a full invoke.
    const latest = await runner.resolveAgentRef("reviewer@latest");
    expect(latest?.name).toBe("v2");
  });

  it("@<iso> pins to a specific version", async () => {
    const v1Ts = await putAndCapture(store, makeAgent("v1"));
    await new Promise((r) => setTimeout(r, 5));
    await putAndCapture(store, makeAgent("v2"));

    const pinned = await runner.resolveAgentRef(`reviewer@${v1Ts}`);
    expect(pinned?.name).toBe("v1");
  });

  it("throws AgentVersionNotFoundError for an unknown @<iso>", async () => {
    await putAndCapture(store, makeAgent("v1"));

    await expect(
      runner.invoke("reviewer@2030-01-01T00:00:00.000Z", "hi"),
    ).rejects.toBeInstanceOf(AgentVersionNotFoundError);
  });

  it("throws InvalidAgentRefError for malformed @suffix", async () => {
    await putAndCapture(store, makeAgent("v1"));

    await expect(runner.invoke("reviewer@v2", "hi")).rejects.toBeInstanceOf(
      InvalidAgentRefError,
    );
  });

  it("throws AgentNotFoundError for nonexistent id (bare or @latest)", async () => {
    await expect(runner.invoke("ghost", "hi")).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
    await expect(runner.invoke("ghost@latest", "hi")).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it("rejects @version on in-memory registered agents", async () => {
    runner.registerAgent(makeAgent("adhoc"));

    // Bare id works (no version asked).
    const bare = await runner.resolveAgentRef("reviewer");
    expect(bare?.name).toBe("adhoc");

    await expect(
      runner.invoke("reviewer@latest", "hi"),
    ).rejects.toBeInstanceOf(InvalidAgentRefError);
  });

  it("resolveAgentRef swallows errors and returns null", async () => {
    expect(await runner.resolveAgentRef("ghost")).toBeNull();
    expect(await runner.resolveAgentRef("ghost@latest")).toBeNull();
    expect(await runner.resolveAgentRef("foo@bogus")).toBeNull();
  });
});
