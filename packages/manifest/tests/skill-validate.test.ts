import { describe, expect, it, vi } from "vitest";
import { validateSkill, validateSkillFull } from "../src/skill-validate.js";
import type { SkillValidationContext } from "../src/skill-validate.js";

// ═══════════════════════════════════════════════════════════════════════
// Level 1: Structural validation (validateSkill)
// ═══════════════════════════════════════════════════════════════════════

describe("validateSkill - structural", () => {
	it("passes a minimal valid skill", () => {
		const result = validateSkill(`
name: researcher
description: Web research with citation.
instructions: |
  Search broadly and cite sources.
`);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("fails on invalid YAML syntax", () => {
		const result = validateSkill("{ bad yaml [}");
		expect(result.valid).toBe(false);
		expect(result.errors[0].level).toBe("structural");
		expect(result.errors[0].message).toMatch(/YAML syntax/);
	});

	it("fails when YAML parses to non-object", () => {
		const result = validateSkill("- a\n- b");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.message.toLowerCase().includes("object")),
		).toBe(true);
	});

	it("fails on missing name", () => {
		const result = validateSkill(`
description: ok
instructions: |
  ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "name")).toBe(true);
	});

	it("fails on invalid name format (uppercase)", () => {
		const result = validateSkill(`
name: Researcher
description: ok
instructions: ok
`);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "name" && e.message.includes("must match"),
			),
		).toBe(true);
	});

	it("fails on invalid name format (leading number)", () => {
		const result = validateSkill(`
name: 1researcher
description: ok
instructions: ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "name")).toBe(true);
	});

	it("fails on invalid name format (underscore)", () => {
		const result = validateSkill(`
name: researcher_v2
description: ok
instructions: ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "name")).toBe(true);
	});

	it("fails on missing description", () => {
		const result = validateSkill(`
name: researcher
instructions: ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "description")).toBe(true);
	});

	it("fails on empty description", () => {
		const result = validateSkill(`
name: researcher
description: ""
instructions: ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "description")).toBe(true);
	});

	it("fails on missing instructions", () => {
		const result = validateSkill(`
name: researcher
description: ok
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "instructions")).toBe(true);
	});

	it("fails on empty instructions", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ""
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "instructions")).toBe(true);
	});

	it("fails when tools is not an array", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools: "not-an-array"
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path.startsWith("tools"))).toBe(true);
	});

	it("fails when a tool entry lacks 'kind'", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools:
  - tools: [web_search]
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path.startsWith("tools"))).toBe(true);
	});

	it("fails when an mcp tool entry lacks server", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools:
  - kind: mcp
    tools: [a]
`);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path.includes("server"))).toBe(true);
	});

	it("passes with a valid local tools entry", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools:
  - kind: local
    tools: [web_search, fetch_url]
`);
		expect(result.valid).toBe(true);
	});

	it("passes with a valid mcp tools entry", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools:
  - kind: mcp
    server: https://example.com/mcp
    tools: [search]
`);
		expect(result.valid).toBe(true);
	});

	it("passes with a valid agent-as-tool entry", () => {
		const result = validateSkill(`
name: researcher
description: ok
instructions: ok
tools:
  - kind: agent
    agent: child-agent
`);
		expect(result.valid).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Level 2: Full validation (validateSkillFull) — reference integrity
// ═══════════════════════════════════════════════════════════════════════

describe("validateSkillFull - external", () => {
	function mockCtx(
		overrides?: Partial<SkillValidationContext>,
	): SkillValidationContext {
		return {
			resolveAgent: vi.fn().mockResolvedValue(true),
			resolveTools: vi.fn().mockResolvedValue(["search", "fetch"]),
			localTools: ["web_search", "fetch_url"],
			...overrides,
		};
	}

	it("passes when all external refs exist", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: local
    tools: [web_search]
`,
			mockCtx(),
		);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("returns structural failure (does not proceed to external) when invalid yaml", async () => {
		const result = await validateSkillFull(
			`
name: BADNAME
description: ok
instructions: ok
`,
			mockCtx(),
		);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.level === "structural")).toBe(true);
	});

	it("errors on missing inline (local) tool", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: local
    tools: [missing_tool]
`,
			mockCtx({ localTools: ["web_search"] }),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.level === "external" && e.message.includes("missing_tool"),
			),
		).toBe(true);
	});

	it("errors on missing MCP server tool", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: mcp
    server: https://example.com/mcp
    tools: [nonexistent]
`,
			mockCtx({ resolveTools: vi.fn().mockResolvedValue(["search"]) }),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.level === "external" && e.message.includes("nonexistent"),
			),
		).toBe(true);
	});

	it("warns on unreachable MCP server (not strict)", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: mcp
    server: https://unreachable.example.com
    tools: [search]
`,
			mockCtx({
				resolveTools: vi
					.fn()
					.mockRejectedValue(new Error("Connection refused")),
			}),
		);
		expect(result.valid).toBe(true);
		expect(
			result.warnings.some((w) => w.message.includes("Connection refused")),
		).toBe(true);
	});

	it("errors on unreachable MCP server when strict", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: mcp
    server: https://unreachable.example.com
    tools: [search]
`,
			mockCtx({
				strict: true,
				resolveTools: vi
					.fn()
					.mockRejectedValue(new Error("Connection refused")),
			}),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) =>
					e.level === "external" && e.message.includes("Connection refused"),
			),
		).toBe(true);
	});

	it("errors when agent-as-tool ref does not resolve", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: agent
    agent: missing-agent
`,
			mockCtx({ resolveAgent: vi.fn().mockResolvedValue(false) }),
		);
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.level === "external" && e.message.includes("missing-agent"),
			),
		).toBe(true);
	});

	it("passes when agent-as-tool ref resolves", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
tools:
  - kind: agent
    agent: outline-agent
`,
			mockCtx({ resolveAgent: vi.fn().mockResolvedValue(true) }),
		);
		expect(result.valid).toBe(true);
	});

	it("passes when no tools are declared", async () => {
		const result = await validateSkillFull(
			`
name: researcher
description: ok
instructions: ok
`,
			mockCtx(),
		);
		expect(result.valid).toBe(true);
	});
});
