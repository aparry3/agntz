import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type {
  ModelProvider,
  GenerateTextOptions,
  GenerateTextResult,
} from "@agntz/core";
import { agntz, tool, z } from "../src/index.js";
import { sqliteStore } from "../src/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures/agents");

class MockModelProvider implements ModelProvider {
  public calls: GenerateTextOptions[] = [];
  constructor(private readonly responses: GenerateTextResult[]) {}
  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push(options);
    return this.responses[this.calls.length - 1] ?? this.responses[this.responses.length - 1];
  }
}

function plainResponse(text: string): GenerateTextResult {
  return {
    text,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    finishReason: "stop",
  };
}

const noopTools = [
  tool({
    name: "add",
    description: "Adds two numbers",
    input: z.object({ a: z.number(), b: z.number() }),
    execute: async () => 0,
  }),
];

describe("@agntz/sdk/sqlite — sqliteStore()", () => {
  it("runs an agent against a sqlite-backed store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
    const dbPath = join(dir, "agntz.db");
    try {
      const provider = new MockModelProvider([plainResponse("persisted")]);
      const client = await agntz({
        agents: fixturesDir,
        tools: noopTools,
        modelProvider: provider,
        store: sqliteStore(dbPath),
      });
      const result = await client.agents.run({ agentId: "echo", input: "hello" });
      expect(result.output).toBe("persisted");
      expect(result.sessionId).toBeTypeOf("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists session messages across separate client instances against the same db", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
    const dbPath = join(dir, "agntz.db");
    try {
      const sessionId = "fixed-test-session";

      // First client run — persist a message
      const provider1 = new MockModelProvider([plainResponse("turn one")]);
      const client1 = await agntz({
        agents: fixturesDir,
        tools: noopTools,
        modelProvider: provider1,
        store: sqliteStore(dbPath),
      });
      await client1.agents.run({ agentId: "echo", input: "first turn", sessionId });

      // Second client against the same db — session should already exist
      const provider2 = new MockModelProvider([plainResponse("turn two")]);
      const client2 = await agntz({
        agents: fixturesDir,
        tools: noopTools,
        modelProvider: provider2,
        store: sqliteStore(dbPath),
      });
      const result2 = await client2.agents.run({
        agentId: "echo",
        input: "second turn",
        sessionId,
      });
      expect(result2.sessionId).toBe(sessionId);

      // Verify the underlying session store has both turns persisted
      const messages = await (client2._runner as unknown as {
        sessionStore: { getMessages(id: string): Promise<unknown[]> };
      }).sessionStore.getMessages(sessionId);
      expect(messages.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
