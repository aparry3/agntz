import { describe, expect, it } from "vitest";
import { defineAgent } from "../src/agent.js";

describe("defineAgent", () => {
	it("creates a valid agent definition", () => {
		const agent = defineAgent({
			id: "test-agent",
			name: "Test Agent",
			systemPrompt: "You are a test agent.",
			model: { provider: "openai", name: "gpt-5.4-mini" },
		});

		expect(agent.id).toBe("test-agent");
		expect(agent.name).toBe("Test Agent");
		expect(agent.systemPrompt).toBe("You are a test agent.");
		expect(agent.model.provider).toBe("openai");
		expect(agent.model.name).toBe("gpt-5.4-mini");
		expect(agent.createdAt).toBeDefined();
		expect(agent.updatedAt).toBeDefined();
	});

	it("throws if id is missing", () => {
		expect(() =>
			defineAgent({
				id: "",
				name: "Test",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		).toThrow("requires an 'id'");
	});

	it("throws if name is missing", () => {
		expect(() =>
			defineAgent({
				id: "test",
				name: "",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		).toThrow("requires a 'name'");
	});

	it("throws if systemPrompt is missing", () => {
		expect(() =>
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		).toThrow("requires a 'systemPrompt'");
	});

	it("throws if model provider is missing", () => {
		expect(() =>
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "test",
				model: { provider: "", name: "gpt-5.4" },
			}),
		).toThrow("requires both 'provider' and 'name'");
	});

	it("preserves optional fields", () => {
		const agent = defineAgent({
			id: "full-agent",
			name: "Full Agent",
			description: "A fully configured agent",
			version: "1.0.0",
			systemPrompt: "Be helpful.",
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4-6",
				temperature: 0.5,
			},
			tools: [{ type: "inline", name: "my-tool" }],
			contextWrite: true,
			tags: ["test", "demo"],
			metadata: { custom: "value" },
		});

		expect(agent.description).toBe("A fully configured agent");
		expect(agent.version).toBe("1.0.0");
		expect(agent.model.temperature).toBe(0.5);
		expect(agent.tools).toHaveLength(1);
		expect(agent.contextWrite).toBe(true);
		expect(agent.tags).toEqual(["test", "demo"]);
		expect(agent.metadata).toEqual({ custom: "value" });
	});
});
