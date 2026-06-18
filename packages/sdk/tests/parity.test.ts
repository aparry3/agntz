import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AgentsResource,
	DatasetsResource,
	EvalsResource,
	MemoryResource,
	RunsResource,
	SessionsResource,
	TracesResource,
} from "@agntz/client";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { createMemrez } from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { type LocalClient, agntz, tool, z } from "../src/index.js";

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

const plain = (text: string): GenerateTextResult => ({
	text,
	usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
	finishReason: "stop",
});

const noopTools = [
	tool({
		name: "add",
		description: "Adds two numbers",
		input: z.object({ a: z.number(), b: z.number() }),
		execute: async () => 0,
	}),
];

async function setup(responses: GenerateTextResult[] = [plain("ok")]) {
	return agntz({
		agents: fixturesDir,
		tools: noopTools,
		modelProvider: new MockModelProvider(responses),
		memrez: createMemrez(),
	});
}

describe("agents — list / get / import", () => {
	it("lists loaded agents as AgentSummary[]", async () => {
		const client = await setup();
		const agents = await client.agents.list();
		expect(agents.map((a) => a.id)).toContain("echo");
		expect(agents.every((a) => typeof a.name === "string")).toBe(true);
	});

	it("gets an agent definition (client shape)", async () => {
		const client = await setup();
		const def = await client.agents.get("echo");
		expect(def.id).toBe("echo");
		expect(def.model?.provider).toBe("openai");
		expect(typeof def.systemPrompt).toBe("string");
	});

	it("imports a manifest and makes it listable + runnable", async () => {
		const client = await setup([plain("imported answer")]);
		const yaml = [
			"id: imported",
			"kind: llm",
			"model:",
			"  provider: openai",
			"  name: gpt-5.4",
			"instruction: Reply helpfully.",
		].join("\n");

		const res = await client.agents.import({ agents: [{ manifest: yaml }] });
		expect(res.results[0]).toMatchObject({ id: "imported", action: "create" });
		expect(res.counts.create).toBe(1);
		expect((await client.agents.list()).map((a) => a.id)).toContain("imported");

		const run = await client.agents.run({ agentId: "imported", input: "hi" });
		expect(run.output).toBe("imported answer");
	});

	it("honors onConflict=skip / fail on re-import", async () => {
		const client = await setup();
		const yaml =
			"id: echo\nkind: llm\nmodel:\n  provider: openai\n  name: gpt-5.4\ninstruction: x";
		const skipped = await client.agents.import({
			agents: [{ manifest: yaml }],
			onConflict: "skip",
		});
		expect(skipped.results[0].action).toBe("skip");
		await expect(
			client.agents.import({
				agents: [{ manifest: yaml }],
				onConflict: "fail",
			}),
		).rejects.toThrow(/already exists/);
	});
});

describe("sessions.import", () => {
	it("writes snapshot messages into the session store", async () => {
		const client = await setup();
		const res = await client.sessions.import({
			sessions: [
				{
					sessionId: "imp_s1",
					agentId: "echo",
					messages: [
						{
							role: "user",
							content: "hello",
							timestamp: "2026-01-01T00:00:00Z",
						},
						{
							role: "assistant",
							content: "hi there",
							timestamp: "2026-01-01T00:00:01Z",
						},
					],
				},
			],
		});
		expect(res.results[0]).toMatchObject({
			sessionId: "imp_s1",
			action: "create",
			messageCount: 2,
		});
		const detail = await client.sessions.get("imp_s1");
		expect(detail.messages).toHaveLength(2);
	});

	it("supports dryRun (no write)", async () => {
		const client = await setup();
		const res = await client.sessions.import({
			dryRun: true,
			sessions: [
				{
					sessionId: "dry_s1",
					messages: [
						{ role: "user", content: "x", timestamp: "2026-01-01T00:00:00Z" },
					],
				},
			],
		});
		expect(res.dryRun).toBe(true);
		const detail = await client.sessions.get("dry_s1");
		expect(detail.messages).toHaveLength(0);
	});
});

describe("traces.delete + stream", () => {
	it("deletes a recorded trace; stream replays a snapshot", async () => {
		const client = await setup([plain("traced")]);
		await client.agents.run({ agentId: "echo", input: "hi" });
		const before = await client.traces.list();
		expect(before.rows.length).toBeGreaterThan(0);
		const traceId = before.rows[0].traceId;

		const events: string[] = [];
		for await (const ev of client.traces.stream(traceId)) events.push(ev.type);
		expect(events).toContain("snapshot");

		await client.traces.delete(traceId);
		const after = await client.traces.list();
		expect(after.rows.map((r) => r.traceId)).not.toContain(traceId);
	});
});

describe("memory.import", () => {
	it("writes raw entries straight to the store", async () => {
		const client = await setup();
		const res = await client.memory?.import({
			entries: [
				{
					id: "m1",
					scope: "test/u1",
					content: "the user likes blue",
					topics: ["preferences"],
					type: "preference",
					status: "active",
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
			],
		});
		expect(res?.results[0]).toMatchObject({ id: "m1", action: "create" });
		const entries = await client.memory?.list(["test/u1"]);
		expect(entries?.map((e) => e.id)).toContain("m1");
	});
});

describe("runs — full-fidelity lifecycle via the shared core registry", () => {
	it("start → stream (multiplexed) → terminal", async () => {
		const client = await setup([plain("async answer")]);
		const run = await client.runs.start({ agentId: "echo", input: "hi" });
		expect(["pending", "running"]).toContain(run.status);

		const types: string[] = [];
		for await (const ev of client.runs.stream({ runId: run.id })) {
			types.push(ev.type);
		}
		// The root run's lifecycle terminates the subtree feed.
		expect(types).toContain("run-complete");

		const final = await client.runs.get(run.id);
		expect(final.status).toBe("completed");
		expect(final.result?.output).toBe("async answer");
		// Started runs are first-class: they show up in runs.list via persistRun.
		expect((await client.runs.list()).rows.map((r) => r.id)).toContain(run.id);
	});

	it("cancel returns the run handle", async () => {
		const client = await setup([plain("x")]);
		const run = await client.runs.start({ agentId: "echo", input: "hi" });
		const cancelled = await client.runs.cancel(run.id);
		expect(cancelled.id).toBe(run.id);
	});
});

describe("surface parity: @agntz/sdk LocalClient ⊇ @agntz/client resources", () => {
	// The documented parity surface. Each method must be callable on BOTH the
	// hosted client resource and the embedded LocalClient — a true two-sided
	// check. (We assert an explicit list rather than reflecting the hosted
	// prototype, which would leak TS-`private` helpers like `listPage`.)
	const SURFACE = {
		agents: {
			hosted: AgentsResource,
			methods: ["list", "get", "import", "run", "stream"],
		},
		runs: {
			hosted: RunsResource,
			methods: ["list", "get", "start", "stream", "cancel"],
		},
		sessions: {
			hosted: SessionsResource,
			methods: ["list", "get", "import", "delete"],
		},
		traces: {
			hosted: TracesResource,
			methods: ["list", "get", "stream", "delete"],
		},
		memory: {
			hosted: MemoryResource,
			methods: [
				"import",
				"scan",
				"read",
				"list",
				"deleteEntry",
				"correct",
				"curate",
				"deleteScope",
			],
		},
		datasets: {
			hosted: DatasetsResource,
			methods: ["list", "create", "get", "update", "delete"],
		},
		evals: {
			hosted: EvalsResource,
			methods: [
				"list",
				"create",
				"get",
				"update",
				"delete",
				"run",
				"getRun",
				"listRuns",
				"cancelRun",
				"getLatestScore",
				"listLatestScores",
			],
		},
	} as const;

	function isFn(obj: unknown, name: string): boolean {
		return typeof (obj as Record<string, unknown>)?.[name] === "function";
	}

	it("each documented method is present on the hosted class and the embedded client", async () => {
		const client: LocalClient = await setup();
		for (const [key, { hosted, methods }] of Object.entries(SURFACE)) {
			const sdkResource = (client as unknown as Record<string, unknown>)[key];
			expect(sdkResource, `LocalClient.${key} missing`).toBeDefined();
			for (const method of methods) {
				expect(
					isFn(hosted.prototype, method),
					`@agntz/client ${hosted.name}.${method} missing`,
				).toBe(true);
				expect(
					isFn(sdkResource, method),
					`@agntz/sdk ${key}.${method} missing`,
				).toBe(true);
			}
		}
	});
});
