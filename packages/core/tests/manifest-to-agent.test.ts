import { describe, expect, it } from "vitest";
import { manifestToAgentDefinition } from "../src/manifest-to-agent.js";
import type { LLMAgentManifest } from "../src/manifest/index.js";

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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(["calc"]),
		});
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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});
		expect(def.tools).toEqual([{ type: "http", entry: httpEntry }]);
	});

	it("passes client tool contracts through without implementations", () => {
		const clientEntry = {
			kind: "client" as const,
			name: "get_selection",
			description: "Read the application's current selection",
			inputSchema: {
				type: "object",
				properties: { includeText: { type: "boolean" } },
				additionalProperties: false,
			},
			timeoutMs: 5_000,
		};
		const def = manifestToAgentDefinition(baseLlm({ tools: [clientEntry] }));
		expect(def.tools).toEqual([{ type: "client", entry: clientEntry }]);
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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});
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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});
		expect(def.tools).toEqual([{ type: "agent", agentId: "reviewer" }]);
	});

	it("converts manifest outputSchema to strict JSON Schema", () => {
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

		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});

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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});
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
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: new Set(),
		});
		expect(def.resources).toEqual(manifest.resources);
	});
});

describe("manifestToAgentDefinition — host-specific options", () => {
	it("throws on a non-llm manifest kind", () => {
		const manifest = { id: "seq", kind: "sequential" } as unknown as Parameters<
			typeof manifestToAgentDefinition
		>[0];
		expect(() => manifestToAgentDefinition(manifest)).toThrow(/only 'llm'/);
	});

	it("uses manifest.instruction as systemPrompt by default", () => {
		const def = manifestToAgentDefinition(baseLlm());
		expect(def.systemPrompt).toBe("be helpful");
	});

	it("uses the systemPrompt override when provided (pre-rendered instruction)", () => {
		const def = manifestToAgentDefinition(baseLlm(), {
			systemPrompt: "RENDERED: be helpful to Alice",
		});
		expect(def.systemPrompt).toBe("RENDERED: be helpful to Alice");
		// `userPromptTemplate` still tracks the manifest's prompt template.
		expect(def.userPromptTemplate).toBeUndefined();
	});

	it("validates local tool names only when localToolNames is supplied (embedded)", () => {
		const manifest = baseLlm({
			tools: [{ kind: "local", tools: ["missing"] }],
		});
		expect(() =>
			manifestToAgentDefinition(manifest, {
				localToolNames: new Set(["calc"]),
			}),
		).toThrow(/local tool 'missing'/);
	});

	it("passes local tool refs through unchecked when localToolNames is omitted (worker)", () => {
		const manifest = baseLlm({
			tools: [{ kind: "local", tools: ["anything"] }],
		});
		const def = manifestToAgentDefinition(manifest);
		expect(def.tools).toEqual([{ type: "inline", name: "anything" }]);
	});

	it("rejects skills when rejectSkills is set (embedded SDK has no SkillStore)", () => {
		const manifest = baseLlm({ skills: ["researcher"] });
		expect(() =>
			manifestToAgentDefinition(manifest, { rejectSkills: true }),
		).toThrow(/declares skills/);
	});

	it("allows skills when rejectSkills is not set (worker resolves via SkillStore)", () => {
		const manifest = baseLlm({ skills: ["researcher"] });
		expect(() => manifestToAgentDefinition(manifest)).not.toThrow();
	});
});
