import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, defineTool } from "../src/tool.js";

describe("defineTool", () => {
	it("creates a valid tool definition", () => {
		const tool = defineTool({
			name: "test-tool",
			description: "A test tool",
			input: z.object({ message: z.string() }),
			async execute(input) {
				return { echo: input.message };
			},
		});

		expect(tool.name).toBe("test-tool");
		expect(tool.description).toBe("A test tool");
		expect(tool.execute).toBeTypeOf("function");
	});

	it("throws if name is missing", () => {
		expect(() =>
			defineTool({
				name: "",
				description: "test",
				input: z.object({}),
				async execute() {
					return {};
				},
			}),
		).toThrow("requires a 'name'");
	});
});

describe("ToolRegistry", () => {
	const makeTool = (name: string) =>
		defineTool({
			name,
			description: `Tool: ${name}`,
			input: z.object({ value: z.string() }),
			async execute(input) {
				return { result: input.value };
			},
		});

	it("registers and lists tools", () => {
		const registry = new ToolRegistry();
		registry.register(makeTool("tool-a"));
		registry.register(makeTool("tool-b"));

		const tools = registry.list();
		expect(tools).toHaveLength(2);
		expect(tools.map((t) => t.name)).toEqual(["tool-a", "tool-b"]);
	});

	it("gets a tool by name", () => {
		const registry = new ToolRegistry();
		registry.register(makeTool("my-tool"));

		const info = registry.get("my-tool");
		expect(info).toBeDefined();
		expect(info?.name).toBe("my-tool");
		expect(info?.source).toBe("inline");
		expect(info?.inputSchema).toBeDefined();
	});

	it("returns undefined for unknown tool", () => {
		const registry = new ToolRegistry();
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("prevents duplicate registration", () => {
		const registry = new ToolRegistry();
		registry.register(makeTool("dupe"));
		expect(() => registry.register(makeTool("dupe"))).toThrow(
			"already registered",
		);
	});

	it("executes a tool", async () => {
		const registry = new ToolRegistry();
		registry.register(makeTool("exec-test"));

		const ctx = {
			agentId: "test",
			invocationId: "inv_123",
			invoke: async () => ({
				output: "",
				invocationId: "",
				sessionId: "",
				toolCalls: [],
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				duration: 0,
				model: "",
			}),
		};

		const result = await registry.execute("exec-test", { value: "hello" }, ctx);
		expect(result).toEqual({ result: "hello" });
	});

	it("throws when executing unknown tool", async () => {
		const registry = new ToolRegistry();
		const ctx = {
			agentId: "test",
			invocationId: "inv_123",
			invoke: async () => ({
				output: "",
				invocationId: "",
				sessionId: "",
				toolCalls: [],
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				duration: 0,
				model: "",
			}),
		};

		await expect(registry.execute("nope", {}, ctx)).rejects.toThrow(
			"not found",
		);
	});

	it("has correct size", () => {
		const registry = new ToolRegistry();
		expect(registry.size).toBe(0);
		registry.register(makeTool("a"));
		expect(registry.size).toBe(1);
	});

	it("generates JSON schema from Zod input", () => {
		const registry = new ToolRegistry();
		registry.register(
			defineTool({
				name: "schema-test",
				description: "Test",
				input: z.object({
					name: z.string(),
					age: z.number(),
					optional: z.string().optional(),
				}),
				async execute() {
					return {};
				},
			}),
		);

		const info = registry.get("schema-test");
		expect(info?.inputSchema).toEqual({
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
				optional: { type: "string" },
			},
			required: ["name", "age"],
		});
	});
});
