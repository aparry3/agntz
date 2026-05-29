import type { LLMAgentManifest } from "@agntz/manifest";
import { describe, expect, it } from "vitest";
import { manifestToAgentDefinition } from "../src/manifest-to-agent.js";

function baseLlm(extras: Partial<LLMAgentManifest> = {}): LLMAgentManifest {
	return {
		id: "test-agent",
		kind: "llm",
		model: { provider: "openai", name: "gpt-5.4" },
		instruction: "be helpful",
		...extras,
	};
}

describe("manifestToAgentDefinition — tool kind conversion", () => {
	it("converts local tools to inline ToolReferences", () => {
		const manifest = baseLlm({
			tools: [{ kind: "local", tools: ["calc"] }],
		});
		const def = manifestToAgentDefinition(manifest, new Set(["calc"]));
		expect(def.tools).toEqual([{ type: "inline", name: "calc" }]);
	});

	it("passes HTTP entries straight through", () => {
		const httpEntry = {
			kind: "http" as const,
			name: "echo",
			url: "https://api.example.com/echo",
			headers: { Authorization: "Bearer {{env.TOK}}" },
		};
		const manifest = baseLlm({ tools: [httpEntry] });
		const def = manifestToAgentDefinition(manifest, new Set());
		expect(def.tools).toEqual([{ type: "http", entry: httpEntry }]);
	});

	it("converts MCP entries with raw URL + headers to mcp ToolReferences", () => {
		const manifest = baseLlm({
			tools: [
				{
					kind: "mcp",
					server: "https://search.example.com/mcp",
					tools: ["search", { tool: "fetch_url", name: "fetch" }],
					headers: { Authorization: "Bearer {{env.SEARCH_KEY}}" },
				},
			],
		});
		const def = manifestToAgentDefinition(manifest, new Set());
		expect(def.tools).toEqual([
			{
				type: "mcp",
				server: "https://search.example.com/mcp",
				tools: ["search", "fetch_url"],
				headers: { Authorization: "Bearer {{env.SEARCH_KEY}}" },
			},
		]);
	});

	it("converts agent-as-tool entries to agent ToolReferences", () => {
		const manifest = baseLlm({
			tools: [{ kind: "agent", agent: "reviewer" }],
		});
		const def = manifestToAgentDefinition(manifest, new Set());
		expect(def.tools).toEqual([{ type: "agent", agentId: "reviewer" }]);
	});

	it("converts manifest outputSchema to strict JSON Schema for embedded runs", () => {
		const manifest = baseLlm({
			outputSchema: {
				answer: "string",
				confidence: "number",
				nested: {
					type: "object",
					properties: {
						approved: { type: "boolean" },
					},
				},
			},
		});

		const def = manifestToAgentDefinition(manifest, new Set());

		expect(def.outputSchema).toEqual({
			type: "object",
			properties: {
				answer: { type: "string" },
				confidence: { type: "number" },
				nested: {
					type: "object",
					properties: {
						approved: { type: "boolean" },
					},
					additionalProperties: false,
				},
			},
			required: ["answer", "confidence", "nested"],
			additionalProperties: false,
		});
	});

	it("translates spawnable refs (ref + inline) for the core runner", () => {
		const manifest = baseLlm({
			spawnable: [
				{ kind: "ref", agentId: "reviewer" },
				{
					kind: "inline",
					definition: {
						id: "child",
						kind: "llm",
						model: { provider: "openai", name: "gpt-5.4" },
						instruction: "be a child",
					},
				},
			],
		});
		const def = manifestToAgentDefinition(manifest, new Set());
		expect(def.spawnable).toHaveLength(2);
		expect(def.spawnable?.[0]).toEqual({ kind: "ref", agentId: "reviewer" });
		expect(def.spawnable?.[1].kind).toBe("inline");
	});

	it("passes resources through to the core agent definition", () => {
		const manifest = baseLlm({
			resources: {
				memory: {
					kind: "memory",
					mode: "read-write",
					autoScan: true,
				},
				"product-docs": {
					kind: "rag",
					mode: "read",
					namespace: "gymtext/kb/product-docs",
				},
			},
		});
		const def = manifestToAgentDefinition(manifest, new Set());
		expect(def.resources).toEqual(manifest.resources);
	});
});
