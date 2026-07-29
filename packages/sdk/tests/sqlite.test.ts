import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { describe, expect, it } from "vitest";
import { agntz, tool, z } from "../src/index.js";
import { sqliteStore } from "../src/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures/agents");

class MockModelProvider implements ModelProvider {
	public calls: GenerateTextOptions[] = [];
	constructor(private readonly responses: GenerateTextResult[]) {}
	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		this.calls.push(options);
		return (
			this.responses[this.calls.length - 1] ??
			this.responses[this.responses.length - 1]
		);
	}
}

class BlockingModelProvider implements ModelProvider {
	readonly started: Promise<void>;
	private notifyStarted!: () => void;

	constructor() {
		this.started = new Promise((resolve) => {
			this.notifyStarted = resolve;
		});
	}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		this.notifyStarted();
		return new Promise((_, reject) => {
			const abort = () => reject(new Error("model call aborted"));
			if (options.signal?.aborted) abort();
			else options.signal?.addEventListener("abort", abort, { once: true });
		});
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
			const result = await client.agents.run({
				agentId: "echo",
				input: "hello",
			});
			expect(result.output).toBe("persisted");
			expect(result.sessionId).toBeTypeOf("string");
			await client.close();
			await client.close();
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
			await client1.agents.run({
				agentId: "echo",
				input: "first turn",
				sessionId,
			});
			await client1.close();

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
			const messages = await (
				client2._runner as unknown as {
					sessionStore: { getMessages(id: string): Promise<unknown[]> };
				}
			).sessionStore.getMessages(sessionId);
			expect(messages.length).toBeGreaterThanOrEqual(2);
			await client2.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists runs and traces across separate client instances", async () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
		const dbPath = join(dir, "agntz.db");
		try {
			const client1 = await agntz({
				agents: fixturesDir,
				tools: noopTools,
				modelProvider: new MockModelProvider([plainResponse("saved")]),
				store: sqliteStore(dbPath),
			});
			await client1.agents.run({ agentId: "echo", input: "remember me" });
			const firstRuns = await client1.runs.list();
			const firstTraces = await client1.traces.list();
			expect(firstRuns.rows).toHaveLength(1);
			expect(firstTraces.rows).toHaveLength(1);
			await client1.close();

			const client2 = await agntz({
				agents: fixturesDir,
				tools: noopTools,
				modelProvider: new MockModelProvider([plainResponse("unused")]),
				store: sqliteStore(dbPath),
			});
			const secondRuns = await client2.runs.list();
			const secondTraces = await client2.traces.list();
			expect(secondRuns.rows.map((run) => run.input)).toContain("remember me");
			expect(secondTraces.rows.map((trace) => trace.traceId)).toContain(
				firstTraces.rows[0].traceId,
			);
			expect(
				await client2.traces.get(firstTraces.rows[0].traceId),
			).not.toBeNull();
			await client2.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("cancels and persists active runs before closing the owned database", async () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
		const dbPath = join(dir, "agntz.db");
		try {
			const provider = new BlockingModelProvider();
			const client1 = await agntz({
				agents: fixturesDir,
				tools: noopTools,
				modelProvider: provider,
				store: sqliteStore(dbPath),
			});
			const started = await client1.runs.start({
				agentId: "echo",
				input: "wait",
			});
			await provider.started;

			await client1.close();

			const client2 = await agntz({
				agents: fixturesDir,
				tools: noopTools,
				modelProvider: new MockModelProvider([plainResponse("unused")]),
				store: sqliteStore(dbPath),
			});
			expect((await client2.runs.get(started.id)).status).toBe("cancelled");
			await client2.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("resolves persisted agent versions by latest, timestamp, and alias", async () => {
		const dir = mkdtempSync(join(tmpdir(), "runner-sqlite-"));
		const dbPath = join(dir, "agntz.db");
		try {
			const store = sqliteStore(dbPath);
			const provider = new MockModelProvider([
				plainResponse("latest result"),
				plainResponse("stable result"),
			]);
			const client = await agntz({
				agents: fixturesDir,
				tools: noopTools,
				modelProvider: provider,
				store,
			});
			const original = (await store.listAgentVersions("echo"))[0].createdAt;

			await client.agents.import({
				agents: [
					{
						id: "echo",
						manifest: `
id: echo
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Version two: {{userQuery}}"
`,
					},
				],
				onConflict: "version",
			});
			const versions = await store.listAgentVersions("echo");
			expect(versions).toHaveLength(2);
			await store.setAgentVersionAlias("echo", original, "stable");

			expect((await client.agents.get("echo@latest")).systemPrompt).toContain(
				"Version two",
			);
			expect(
				(await client.agents.get(`echo@${original}`)).systemPrompt,
			).toContain("echo bot");
			expect((await client.agents.get("echo@stable")).systemPrompt).toContain(
				"echo bot",
			);

			await client.agents.run({ agentId: "echo@latest", input: "new" });
			await client.agents.run({ agentId: "echo@stable", input: "old" });
			const runs = await client.runs.list();
			expect(runs.rows.map((run) => run.requestedAgentVersion)).toEqual([
				"stable",
				"latest",
			]);
			expect(runs.rows[0].agentVersion).toBe(original);
			expect(runs.rows[1].agentVersion).toBe(versions[0].createdAt);
			await client.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
