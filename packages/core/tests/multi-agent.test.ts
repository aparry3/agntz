import { describe, expect, it } from "vitest";
import { defineAgent } from "../src/agent.js";
import { InMemoryRunRegistry } from "../src/run-registry.js";
import { createRunner } from "../src/runner.js";
import type {
	AgentDefinition,
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "../src/types.js";

interface Rule {
	match: (opts: GenerateTextOptions) => boolean;
	respond: (opts: GenerateTextOptions, callIdx: number) => GenerateTextResult;
	/** Optional artificial delay before resolving (ms). Used to interleave parent/child. */
	delayMs?: number;
}

class ScriptedModelProvider implements ModelProvider {
	public callsByRule = new Map<number, number>();
	public allCalls: GenerateTextOptions[] = [];

	constructor(private rules: Rule[]) {}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
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
			`ScriptedModelProvider: no rule matched for messages:\n${options.messages
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

function lastUserMessage(opts: GenerateTextOptions): string {
	for (let i = opts.messages.length - 1; i >= 0; i--) {
		if (opts.messages[i].role === "user") return opts.messages[i].content;
	}
	return "";
}

function spawnCall(
	toolUseId: string,
	agentId: string,
	input: string,
): GenerateTextResult {
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

describe("multi-agent spawning", () => {
	it("parent spawns child, sees child output as notification, then finishes", async () => {
		const provider = new ScriptedModelProvider([
			// Researcher: just emits a result.
			{
				match: (o) => hasMarker(o, "RESEARCHER"),
				respond: () => ({
					text: "the answer is 42",
					usage,
					finishReason: "stop",
				}),
			},
			// Parent: first turn spawns a child; later turn synthesizes.
			{
				match: (o) => hasMarker(o, "PARENT"),
				respond: (opts, callIdx) => {
					if (callIdx === 0)
						return spawnCall("tc1", "researcher", "what is the answer");
					// Subsequent calls: respond with synthesis once we've seen the
					// child's completion notification.
					const seenNotice = opts.messages.some(
						(m) =>
							m.role === "user" &&
							m.content.includes("[Spawned agent completion]"),
					);
					if (!seenNotice) {
						// Without the notification yet — just emit text with no tools.
						// This forces the runner to drain.
						return { text: "(thinking...)", usage, finishReason: "stop" };
					}
					return {
						text: "FINAL: I learned the answer is 42",
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
			makeAgent("parent", "PARENT", [{ kind: "ref", agentId: "researcher" }]),
		);

		const result = await runner.invoke("parent", "find the answer", {
			runRegistry: registry,
		});

		expect(result.output).toBe("FINAL: I learned the answer is 42");
		// Parent loop ran at least 3 times (spawn → drain → resume)
		expect(provider.callsByRule.get(1) ?? 0).toBeGreaterThanOrEqual(2);
		// Child ran exactly once
		expect(provider.callsByRule.get(0)).toBe(1);
	});

	it("drain phase forbids parent from finishing while children are still running", async () => {
		const provider = new ScriptedModelProvider([
			// Slow child — gives parent's first "thinking..." response a chance to
			// be issued before the child settles.
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
						(m) =>
							m.role === "user" &&
							m.content.includes("[Spawned agent completion]"),
					);
					// The parent ALWAYS emits final-looking text. The drain rule is what
					// keeps it from terminating too early.
					if (!seenNotice) {
						return {
							text: "I'm done now (incorrectly)",
							usage,
							finishReason: "stop",
						};
					}
					return {
						text: "now I have the slow answer",
						usage,
						finishReason: "stop",
					};
				},
			},
		]);

		const runner = createRunner({ modelProvider: provider });
		const registry = new InMemoryRunRegistry();

		runner.registerAgent(makeAgent("slow", "SLOW_CHILD"));
		runner.registerAgent(
			makeAgent("parent", "IMPATIENT_PARENT", [
				{ kind: "ref", agentId: "slow" },
			]),
		);

		const result = await runner.invoke("parent", "go", {
			runRegistry: registry,
		});

		// Critical: the parent's *first* "I'm done" attempt did NOT terminate the run.
		// The final output reflects the post-notice synthesis.
		expect(result.output).toBe("now I have the slow answer");
	});

	it("does not register spawn_agent when no runRegistry is provided", async () => {
		const provider = new ScriptedModelProvider([
			{
				match: (o) => hasMarker(o, "PARENT_NO_REG"),
				respond: (opts) => {
					// Inspect the tool list to make sure spawn_agent isn't there.
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
			makeAgent("parent", "PARENT_NO_REG", [
				{ kind: "ref", agentId: "researcher" },
			]),
		);

		const result = await runner.invoke("parent", "go"); // no runRegistry

		expect(result.output).toBe("tools=");
	});

	it("registers spawn_agent and check_agents when registry IS provided", async () => {
		const provider = new ScriptedModelProvider([
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
			makeAgent("parent", "PARENT_WITH_REG", [
				{ kind: "ref", agentId: "researcher" },
			]),
		);

		const result = await runner.invoke("parent", "go", {
			runRegistry: registry,
		});

		expect(result.output).toBe("tools=check_agents,spawn_agent");
	});

	it("limits concurrent children — extra spawns return an error tool result", async () => {
		// Test the spawn_agent tool's limits gate by calling it directly.
		const runner = createRunner({
			modelProvider: new ScriptedModelProvider([
				// child blocks forever (until parent aborts) so the slot stays full
				{
					match: (o) => hasMarker(o, "PARKED_CHILD"),
					delayMs: 5000,
					respond: () => ({
						text: "shouldn't reach",
						usage,
						finishReason: "stop",
					}),
				},
			]),
		});
		const registry = new InMemoryRunRegistry();

		const child = defineAgent({
			id: "parked",
			name: "parked",
			systemPrompt: "MARKER:PARKED_CHILD",
			model: { provider: "openai", name: "test-model" },
		});
		runner.registerAgent(child);

		// Build the spawn_agent tool with maxConcurrentChildren=2 so we can hit the limit.
		const { createSpawnAgentTool } = await import(
			"../src/tools/spawn-agent.js"
		);
		const tool = createSpawnAgentTool(
			[{ agentId: "parked", summary: "parked agent" }],
			{ maxConcurrentChildren: 2, maxDepth: 5, maxDescendants: 50 },
		)!;

		// Manually create a parent Run.
		const parent = registry.create({ agentId: "parent", input: "go" });

		const ctx = {
			agentId: "parent",
			invocationId: "inv_test",
			runId: parent.id,
			runRegistry: registry,
			invoke: (id: string, input: string, opts?: any) =>
				runner.invoke(id, input, opts),
		};

		// First two spawns succeed.
		const r1 = (await tool.execute(
			{ agent_id: "parked", input: "1" },
			ctx as any,
		)) as any;
		const r2 = (await tool.execute(
			{ agent_id: "parked", input: "2" },
			ctx as any,
		)) as any;
		expect(r1.run_id).toBeDefined();
		expect(r2.run_id).toBeDefined();

		// Third spawn rejected by the gate.
		const r3 = (await tool.execute(
			{ agent_id: "parked", input: "3" },
			ctx as any,
		)) as any;
		expect(r3.ok).toBe(false);
		expect(r3.error).toMatch(/maxConcurrentChildren/);

		// Cancel everything to clean up.
		registry.cancel(parent.id);
		// Give microtasks a beat to settle
		await new Promise((r) => setTimeout(r, 10));
	});

	it("cancellation cascades from parent to children", async () => {
		const runner = createRunner({
			modelProvider: new ScriptedModelProvider([
				{
					match: (o) => hasMarker(o, "INFINITE_CHILD"),
					// Long enough that the parent cancel happens before child resolves.
					delayMs: 1000,
					respond: () => ({ text: "(too late)", usage, finishReason: "stop" }),
				},
			]),
		});
		const registry = new InMemoryRunRegistry();

		runner.registerAgent(
			defineAgent({
				id: "child",
				name: "child",
				systemPrompt: "MARKER:INFINITE_CHILD",
				model: { provider: "openai", name: "test-model" },
			}),
		);

		const parent = registry.create({ agentId: "parent", input: "x" });
		const { createSpawnAgentTool } = await import(
			"../src/tools/spawn-agent.js"
		);
		const tool = createSpawnAgentTool([{ agentId: "child", summary: "c" }])!;

		const ctx = {
			agentId: "parent",
			invocationId: "inv_test",
			runId: parent.id,
			runRegistry: registry,
			invoke: (id: string, input: string, opts?: any) =>
				runner.invoke(id, input, opts),
		};

		const handle = (await tool.execute(
			{ agent_id: "child", input: "go" },
			ctx as any,
		)) as any;
		expect(handle.run_id).toBeDefined();
		expect(registry.outstandingChildrenCount(parent.id)).toBe(1);

		// Cancel the parent.
		registry.cancel(parent.id, "test-cancel");

		// Drain to let the cancellation propagate through the executor.
		await new Promise((r) => setTimeout(r, 50));

		const child = registry.get(handle.run_id)!;
		expect(child.status).toBe("cancelled");
	});

	it("check_agents returns only this parent's direct children", async () => {
		const runner = createRunner({
			modelProvider: new ScriptedModelProvider([
				{
					match: (o) => hasMarker(o, "FAST"),
					respond: () => ({ text: "done", usage, finishReason: "stop" }),
				},
			]),
		});
		const registry = new InMemoryRunRegistry();

		runner.registerAgent(
			defineAgent({
				id: "fast",
				name: "fast",
				systemPrompt: "MARKER:FAST",
				model: { provider: "openai", name: "test-model" },
			}),
		);

		const parentA = registry.create({ agentId: "pA", input: "" });
		const parentB = registry.create({ agentId: "pB", input: "" });

		const { createSpawnAgentTool, createCheckAgentsTool } = await import(
			"../src/tools/spawn-agent.js"
		);
		const spawn = createSpawnAgentTool([{ agentId: "fast", summary: "fast" }])!;
		const check = createCheckAgentsTool([
			{ agentId: "fast", summary: "fast" },
		])!;

		const mkCtx = (parentId: string) => ({
			agentId: "p",
			invocationId: "inv_x",
			runId: parentId,
			runRegistry: registry,
			invoke: (id: string, input: string, opts?: any) =>
				runner.invoke(id, input, opts),
		});

		await spawn.execute(
			{ agent_id: "fast", input: "a" },
			mkCtx(parentA.id) as any,
		);
		await spawn.execute(
			{ agent_id: "fast", input: "b" },
			mkCtx(parentB.id) as any,
		);

		// Wait for both to complete.
		await new Promise((r) => setTimeout(r, 50));

		const aChildren = (await check.execute(
			{},
			mkCtx(parentA.id) as any,
		)) as any[];
		expect(aChildren.length).toBe(1);
		expect(aChildren[0].status).toBe("completed");

		const bChildren = (await check.execute(
			{},
			mkCtx(parentB.id) as any,
		)) as any[];
		expect(bChildren.length).toBe(1);
	});
});
