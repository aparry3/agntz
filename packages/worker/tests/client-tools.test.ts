import {
	type ClientToolEntry,
	type GenerateTextOptions,
	type GenerateTextResult,
	InMemoryRunRegistry,
	type ModelProvider,
	type ToolContext,
	createRunner,
} from "@agntz/core";
import type { LLMAgentManifest } from "@agntz/core/manifest";
import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { AttachedClientToolBroker } from "../src/client-tools.js";
import { createWorkerAPI } from "../src/routes.js";

function toolContext(runId: string): ToolContext {
	return {
		agentId: "agent_1",
		invocationId: "inv_1",
		runId,
		toolCallId: "call_1",
		invoke: async () => {
			throw new Error("unused");
		},
	};
}

const entry: ClientToolEntry = {
	kind: "client",
	name: "get_selection",
	description: "Read the current application selection",
	inputSchema: {
		type: "object",
		properties: { includeText: { type: "boolean" } },
		additionalProperties: false,
	},
	timeoutMs: 5_000,
};

describe("AttachedClientToolBroker", () => {
	it("emits a request and resolves the tool call after result submission", async () => {
		const registry = new InMemoryRunRegistry({ gracePeriodMs: 60_000 });
		const run = registry.create({
			agentId: "agent_1",
			input: "",
			userId: "user_1",
		});
		const broker = new AttachedClientToolBroker(registry);
		const resultPromise = broker.dispatch("user_1")(
			entry,
			{ includeText: true },
			toolContext(run.id),
		);
		const iterator = registry.subscribe(run.rootId)[Symbol.asyncIterator]();
		let event = (await iterator.next()).value;
		while (event.type !== "client-tool-request") {
			event = (await iterator.next()).value;
		}

		expect(event).toMatchObject({
			type: "client-tool-request",
			runId: run.id,
			rootRunId: run.rootId,
			toolCallId: "call_1",
			name: "get_selection",
			input: { includeText: true },
		});
		if (event.type !== "client-tool-request") {
			throw new Error("expected client-tool-request");
		}
		expect(
			broker.submit({
				ownerId: "user_1",
				rootRunId: run.rootId,
				requestId: event.requestId,
				output: { selected: "chapter one" },
			}),
		).toBe("accepted");
		await expect(resultPromise).resolves.toEqual({
			selected: "chapter one",
		});
		expect(
			broker.submit({
				ownerId: "user_1",
				rootRunId: run.rootId,
				requestId: event.requestId,
				output: { selected: "duplicate" },
			}),
		).toBe("duplicate");
		await iterator.return?.();
	});

	it("rejects handler errors as ordinary tool failures", async () => {
		const registry = new InMemoryRunRegistry({ gracePeriodMs: 60_000 });
		const run = registry.create({
			agentId: "agent_1",
			input: "",
			userId: "user_1",
		});
		const broker = new AttachedClientToolBroker(registry);
		const resultPromise = broker.dispatch("user_1")(
			entry,
			{},
			toolContext(run.id),
		);
		const iterator = registry.subscribe(run.rootId)[Symbol.asyncIterator]();
		let event = (await iterator.next()).value;
		while (event.type !== "client-tool-request") {
			event = (await iterator.next()).value;
		}
		expect(
			broker.submit({
				ownerId: "user_1",
				rootRunId: run.rootId,
				requestId: event.requestId,
				error: "application exploded",
			}),
		).toBe("accepted");
		await expect(resultPromise).rejects.toThrow(/application exploded/);
		await iterator.return?.();
	});
});

describe("client-tool route preflight", () => {
	it("fails before Run creation or a model call when a handler is missing", async () => {
		class NeverCalledProvider implements ModelProvider {
			calls = 0;
			async generateText(
				_options: GenerateTextOptions,
			): Promise<GenerateTextResult> {
				this.calls++;
				throw new Error("model must not be called");
			}
		}
		const provider = new NeverCalledProvider();
		const store = new MemoryStore();
		const registry = new InMemoryRunRegistry({ gracePeriodMs: 60_000 });
		const runner = createRunner({ store, modelProvider: provider });
		const manifest: LLMAgentManifest = {
			id: "client-agent",
			kind: "llm",
			model: { provider: "openai", name: "gpt-5.4" },
			instruction: "Use the selection.",
			tools: [entry],
		};
		const app = createWorkerAPI({
			store,
			internalSecret: "secret",
			runRegistry: registry,
			resolveRunnerAndManifest: async () => ({ runner, manifest }),
		});
		const response = await app.request("/run/stream", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": "secret",
			},
			body: JSON.stringify({
				userId: "user_1",
				agentId: "client-agent",
				clientTools: [],
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "MISSING_CLIENT_TOOLS",
			details: ["get_selection"],
		});
		expect(provider.calls).toBe(0);
		expect(registry.activeRootIds()).toEqual([]);
	});

	it("rejects unattended runs that depend on client tools", async () => {
		const store = new MemoryStore();
		const registry = new InMemoryRunRegistry({ gracePeriodMs: 60_000 });
		const runner = createRunner({ store });
		const manifest: LLMAgentManifest = {
			id: "client-agent",
			kind: "llm",
			model: { provider: "openai", name: "gpt-5.4" },
			instruction: "Use the selection.",
			tools: [entry],
		};
		const app = createWorkerAPI({
			store,
			internalSecret: "secret",
			runRegistry: registry,
			resolveRunnerAndManifest: async () => ({ runner, manifest }),
		});
		const response = await app.request("/runs", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": "secret",
			},
			body: JSON.stringify({
				userId: "user_1",
				agentId: "client-agent",
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "CLIENT_TOOLS_REQUIRE_ATTACHED_RUN",
		});
		expect(registry.activeRootIds()).toEqual([]);
	});
});
