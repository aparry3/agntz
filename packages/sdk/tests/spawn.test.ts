import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { describe, expect, it } from "vitest";
import { agntz } from "../src/index.js";

// Proves that `spawn_agent` works via BOTH `agents.run` and `agents.stream`.
// Before runs were routed through the core RunRegistry, only `runs.start` wired
// a registry — so the runner never materialized the `spawn_agent` tool on the
// agents.run/stream paths, and a spawnable agent could not actually spawn.

const __dirname = dirname(fileURLToPath(import.meta.url));
const spawnFixtures = join(__dirname, "fixtures/spawn");
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

interface Rule {
	match: (o: GenerateTextOptions) => boolean;
	respond: (o: GenerateTextOptions, callIdx: number) => GenerateTextResult;
}

class ScriptedModelProvider implements ModelProvider {
	public allCalls: GenerateTextOptions[] = [];
	private counts = new Map<number, number>();
	constructor(private readonly rules: Rule[]) {}
	async generateText(o: GenerateTextOptions): Promise<GenerateTextResult> {
		this.allCalls.push(o);
		for (let i = 0; i < this.rules.length; i++) {
			if (this.rules[i].match(o)) {
				const c = this.counts.get(i) ?? 0;
				this.counts.set(i, c + 1);
				return this.rules[i].respond(o, c);
			}
		}
		throw new Error(
			`ScriptedModelProvider: no rule matched:\n${o.messages
				.map((m) => `  ${m.role}: ${m.content.slice(0, 60)}`)
				.join("\n")}`,
		);
	}
}

function hasMarker(o: GenerateTextOptions, marker: string): boolean {
	return o.messages.some(
		(m) => m.role === "system" && m.content.includes(`MARKER:${marker}`),
	);
}

function sawSpawnNotice(o: GenerateTextOptions): boolean {
	return o.messages.some(
		(m) =>
			m.role === "user" && m.content.includes("[Spawned agent completion]"),
	);
}

function spawnRules(): Rule[] {
	return [
		// Child agent — emits a result.
		{
			match: (o) => hasMarker(o, "CHILD"),
			respond: () => ({
				text: "child result: 42",
				usage,
				finishReason: "stop",
			}),
		},
		// Parent — first turn spawns the child; once the completion notice lands,
		// it synthesizes the final answer. Intermediate turns return plain text to
		// force the runner to drain the outstanding child.
		{
			match: (o) => hasMarker(o, "PARENT"),
			respond: (o, callIdx) => {
				if (callIdx === 0) {
					return {
						text: "",
						toolCalls: [
							{
								id: "tc1",
								name: "spawn_agent",
								args: { agent_id: "child", input: "do the thing" },
							},
						],
						usage,
						finishReason: "tool-calls",
					};
				}
				if (!sawSpawnNotice(o)) {
					return { text: "(waiting for child)", usage, finishReason: "stop" };
				}
				return {
					text: "FINAL: child reported 42",
					usage,
					finishReason: "stop",
				};
			},
		},
	];
}

describe("spawn_agent through the embedded SDK", () => {
	it("agents.run can spawn a sub-agent (registry now wired on this path)", async () => {
		const provider = new ScriptedModelProvider(spawnRules());
		const client = await agntz({
			agents: spawnFixtures,
			modelProvider: provider,
		});

		const result = await client.agents.run({
			agentId: "parent",
			input: "please spawn the child",
		});

		expect(String(result.output)).toContain("FINAL: child reported 42");
		// The child actually executed (its system marker reached the model).
		expect(provider.allCalls.some((o) => hasMarker(o, "CHILD"))).toBe(true);
	});

	it("agents.stream can spawn a sub-agent", async () => {
		const provider = new ScriptedModelProvider(spawnRules());
		const client = await agntz({
			agents: spawnFixtures,
			modelProvider: provider,
		});

		const events: string[] = [];
		for await (const ev of client.agents.stream({
			agentId: "parent",
			input: "please spawn the child",
		})) {
			events.push(ev.type);
		}

		expect(provider.allCalls.some((o) => hasMarker(o, "CHILD"))).toBe(true);
		expect(events).toContain("complete");
	});
});
