import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/parser.js";

describe("parseManifest", () => {
	it("parses a simple LLM agent", () => {
		const yaml = `
id: chatbot
name: Simple Chatbot
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Answer the question: {{userQuery}}"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.kind).toBe("llm");
		expect(manifest.id).toBe("chatbot");
		if (manifest.kind === "llm") {
			expect(manifest.model.provider).toBe("openai");
			expect(manifest.model.name).toBe("gpt-5.4");
			expect(manifest.instruction).toBe("Answer the question: {{userQuery}}");
		}
	});

	it("parses an LLM agent with tools", () => {
		const yaml = `
id: researcher
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Research this"
tools:
  - kind: mcp
    server: https://mcp.example.com
    tools:
      - toolA
      - tool: search
        name: search_user
        params:
          user_id: "{{userId}}"
  - kind: local
    tools: [calc]
  - kind: agent
    agent: helper
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			expect(manifest.tools).toHaveLength(3);
			const mcp = manifest.tools?.[0];
			expect(mcp.kind).toBe("mcp");
			if (mcp.kind === "mcp") {
				expect(mcp.tools).toHaveLength(2);
				expect(mcp.tools?.[0]).toBe("toolA");
				const wrapped = mcp.tools?.[1];
				expect(typeof wrapped).toBe("object");
				if (typeof wrapped === "object") {
					expect(wrapped.tool).toBe("search");
					expect(wrapped.name).toBe("search_user");
					expect(wrapped.params).toEqual({ user_id: "{{userId}}" });
				}
			}
		}
	});

	it("parses an LLM agent with an HTTP tool entry", () => {
		const yaml = `
id: web-agent
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Use the tool."
tools:
  - kind: http
    name: get_user
    url: "https://api.example.com/users/{userId}?status={status?}"
    description: "Fetch a user record."
    params:
      userId: "{{userId}}"
    headers:
      Authorization: "Bearer {{secrets.api_token}}"
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			expect(manifest.tools).toHaveLength(1);
			const http = manifest.tools?.[0];
			expect(http.kind).toBe("http");
			if (http.kind === "http") {
				expect(http.name).toBe("get_user");
				expect(http.url).toBe(
					"https://api.example.com/users/{userId}?status={status?}",
				);
				expect(http.description).toBe("Fetch a user record.");
				expect(http.params).toEqual({ userId: "{{userId}}" });
				expect(http.headers).toEqual({
					Authorization: "Bearer {{secrets.api_token}}",
				});
			}
		}
	});

	it("parses resources with inferred kind and provider config passthrough", () => {
		const yaml = `
id: support
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Use memory when useful."
resources:
  memory:
    mode: read-write
    autoScan: true
    writePolicy:
      descendants: true
      ancestorPromotion: none
  product-docs:
    kind: rag
    mode: read
    namespace: gymtext/kb/product-docs
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			expect(manifest.resources?.memory).toMatchObject({
				kind: "memory",
				mode: "read-write",
				autoScan: true,
				writePolicy: { descendants: true, ancestorPromotion: "none" },
			});
			expect(manifest.resources?.["product-docs"]).toMatchObject({
				kind: "rag",
				mode: "read",
				namespace: "gymtext/kb/product-docs",
			});
		}
	});

	it("parses a tool agent", () => {
		const yaml = `
id: send-email
kind: tool
tool:
  kind: mcp
  server: https://mcp.example.com
  name: send_email
  params:
    to: "{{recipient}}"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.kind).toBe("tool");
		if (manifest.kind === "tool") {
			expect(manifest.tool.name).toBe("send_email");
			expect(manifest.tool.params).toEqual({ to: "{{recipient}}" });
		}
	});

	it("parses a sequential agent with ref steps", () => {
		const yaml = `
id: pipeline
kind: sequential
steps:
  - ref: researcher
    input:
      query: "{{userQuery}}"
  - ref: formatter
    input:
      content: "{{researcher}}"
    stateKey: final
output:
  result: "{{final}}"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.kind).toBe("sequential");
		if (manifest.kind === "sequential") {
			expect(manifest.steps).toHaveLength(2);
			expect(manifest.steps[0].ref).toBe("researcher");
			expect(manifest.steps[1].stateKey).toBe("final");
			expect(manifest.output).toEqual({ result: "{{final}}" });
		}
	});

	it("parses a sequential agent with until (loop)", () => {
		const yaml = `
id: review-loop
kind: sequential
until: "{{reviewer.approved}} == true"
maxIterations: 5
steps:
  - ref: writer
  - ref: reviewer
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "sequential") {
			expect(manifest.until).toBe("{{reviewer.approved}} == true");
			expect(manifest.maxIterations).toBe(5);
		}
	});

	it("parses a parallel agent with ref branches", () => {
		const yaml = `
id: analyze
kind: parallel
branches:
  - ref: sentiment
    input:
      text: "{{text}}"
  - ref: entities
    input:
      text: "{{text}}"
`;
		const manifest = parseManifest(yaml);
		expect(manifest.kind).toBe("parallel");
		if (manifest.kind === "parallel") {
			expect(manifest.branches).toHaveLength(2);
			expect(manifest.branches[0].ref).toBe("sentiment");
			expect(manifest.branches[1].ref).toBe("entities");
		}
	});

	it("parses inline agent definitions in steps", () => {
		const yaml = `
id: pipeline
kind: sequential
steps:
  - agent:
      id: inline-llm
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: "Summarize: {{data}}"
      stateKey: summarizer
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "sequential") {
			const step = manifest.steps[0];
			expect(step.agent).toBeDefined();
			expect(step.ref).toBeUndefined();
			expect(step.agent?.kind).toBe("llm");
			expect(step.agent?.id).toBe("inline-llm");
		}
	});

	it("throws on missing kind", () => {
		expect(() => parseManifest("id: test")).toThrow("kind");
	});

	it("throws on unknown kind", () => {
		expect(() => parseManifest("id: test\nkind: unknown")).toThrow(
			"Unknown agent kind",
		);
	});

	it("throws on step with neither ref nor agent", () => {
		const yaml = `
id: pipeline
kind: sequential
steps:
  - input:
      x: "{{y}}"
`;
		expect(() => parseManifest(yaml)).toThrow("ref");
	});

	it("parses spawnable with ref + inline entries", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate work."
spawnable:
  - kind: ref
    agentId: researcher
  - kind: inline
    definition:
      id: summarizer
      kind: llm
      model:
        provider: openai
        name: gpt-5.4-mini
      instruction: "Summarize the input."
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			expect(manifest.spawnable).toHaveLength(2);
			const [refEntry, inlineEntry] = manifest.spawnable!;
			expect(refEntry.kind).toBe("ref");
			if (refEntry.kind === "ref") expect(refEntry.agentId).toBe("researcher");
			expect(inlineEntry.kind).toBe("inline");
			if (inlineEntry.kind === "inline") {
				expect(inlineEntry.definition.kind).toBe("llm");
				expect(inlineEntry.definition.id).toBe("summarizer");
			}
		}
	});

	it("throws on spawnable inline definition with non-llm kind", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
spawnable:
  - kind: inline
    definition:
      id: pipeline
      kind: sequential
      steps:
        - ref: x
`;
		expect(() => parseManifest(yaml)).toThrow("llm-kind");
	});

	it("throws on spawnable entry with unknown kind", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
spawnable:
  - kind: weird
    agentId: x
`;
		expect(() => parseManifest(yaml)).toThrow("must be 'ref' or 'inline'");
	});

	it("parses spawnable ref with version: latest and ISO timestamp", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
spawnable:
  - kind: ref
    agentId: a
    version: latest
  - kind: ref
    agentId: b
    version: "2026-05-17T15:30:00.000Z"
  - kind: ref
    agentId: c
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			const [a, b, c] = manifest.spawnable!;
			if (a.kind === "ref") expect(a.version).toBe("latest");
			if (b.kind === "ref") expect(b.version).toBe("2026-05-17T15:30:00.000Z");
			if (c.kind === "ref") expect(c.version).toBeUndefined();
		}
	});

	it("rejects spawnable ref with malformed version", () => {
		// Aliases must start with an alphanumeric and contain only [A-Za-z0-9._-];
		// a leading hyphen is rejected at parse time.
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
spawnable:
  - kind: ref
    agentId: a
    version: "-bad"
`;
		expect(() => parseManifest(yaml)).toThrow(/version/);
	});

	it("parses agent tool with @version suffix in agent field", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
tools:
  - kind: agent
    agent: "helper@latest"
  - kind: agent
    agent: "other"
    version: "2026-05-17T15:30:00.000Z"
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "llm") {
			const [a, b] = manifest.tools!;
			if (a.kind === "agent") {
				expect(a.agent).toBe("helper@latest");
				expect(a.version).toBeUndefined();
			}
			if (b.kind === "agent") {
				expect(b.agent).toBe("other");
				expect(b.version).toBe("2026-05-17T15:30:00.000Z");
			}
		}
	});

	it("rejects agent tool combining @suffix and version field", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
tools:
  - kind: agent
    agent: "helper@latest"
    version: latest
`;
		expect(() => parseManifest(yaml)).toThrow(/'@version'/);
	});

	it("rejects agent tool with malformed @suffix", () => {
		const yaml = `
id: orchestrator
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: "Coordinate."
tools:
  - kind: agent
    agent: "helper@-bad"
`;
		expect(() => parseManifest(yaml)).toThrow(/agent is invalid/);
	});

	it("parses step.ref with @latest", () => {
		const yaml = `
id: pipeline
kind: sequential
steps:
  - ref: "child@latest"
  - ref: "other@2026-05-17T15:30:00.000Z"
`;
		const manifest = parseManifest(yaml);
		if (manifest.kind === "sequential") {
			expect(manifest.steps[0].ref).toBe("child@latest");
			expect(manifest.steps[1].ref).toBe("other@2026-05-17T15:30:00.000Z");
		}
	});
});
