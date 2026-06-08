import { MemoryStore } from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function internalAuthHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

const validYaml = `
id: ok
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: Say ok
`;

describe("POST /run/block", () => {
	it("runs only the selected inline block", async () => {
		const store = new MemoryStore();
		const app = createWorkerAPI({ store, internalSecret: SECRET });
		const rootYaml = `
id: root
kind: sequential
steps:
  - agent:
      id: would_fail_if_run
      kind: tool
      tool:
        kind: local
        name: read_file
        params:
          path: "missing-file.md"
  - agent:
      id: validator
      kind: tool
      inputSchema:
        yaml: string
      tool:
        kind: local
        name: validate_manifest
        params:
          yaml: "{{yaml}}"
`;
		await store.forUser("u1").putAgent({
			id: "root",
			name: "Root",
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
			metadata: { manifest: rootYaml },
		});

		const res = await app.request("/run/block", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "root",
				input: { yaml: validYaml },
				selection: {
					agentPath: ["steps", 1, "agent"],
					stepPath: ["steps", 1],
				},
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			output: { valid: boolean };
			blockId: string;
			target: string;
		};
		expect(body.target).toBe("block");
		expect(body.blockId).toBe("validator");
		expect(body.output.valid).toBe(true);
	});

	it("resolves a selected ref step through the stored manifest", async () => {
		const store = new MemoryStore();
		const app = createWorkerAPI({ store, internalSecret: SECRET });
		const rootYaml = `
id: root
kind: sequential
steps:
  - ref: child_validator
`;
		const childYaml = `
id: child_validator
kind: tool
inputSchema:
  yaml: string
tool:
  kind: local
  name: validate_manifest
  params:
    yaml: "{{yaml}}"
`;
		await store.forUser("u1").putAgent({
			id: "root",
			name: "Root",
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
			metadata: { manifest: rootYaml },
		});
		await store.forUser("u1").putAgent({
			id: "child_validator",
			name: "Child",
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
			metadata: { manifest: childYaml },
		});

		const res = await app.request("/run/block", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "root",
				input: { yaml: validYaml },
				selection: {
					agentPath: ["steps", 0, "agent"],
					stepPath: ["steps", 0],
				},
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			output: { valid: boolean };
			blockId: string;
		};
		expect(body.blockId).toBe("child_validator");
		expect(body.output.valid).toBe(true);
	});

	it("returns 400 for an invalid selection path", async () => {
		const store = new MemoryStore();
		const app = createWorkerAPI({ store, internalSecret: SECRET });
		await store.forUser("u1").putAgent({
			id: "root",
			name: "Root",
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
			metadata: { manifest: validYaml.replace("id: ok", "id: root") },
		});

		const res = await app.request("/run/block", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "root",
				selection: { agentPath: ["missing"] },
			}),
		});

		expect(res.status).toBe(400);
	});
});
