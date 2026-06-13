import { MemoryStore } from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp() {
	const store = new MemoryStore();
	const app = createWorkerAPI({ store, internalSecret: SECRET });
	return { app };
}

function authHeaders(): Record<string, string> {
	return {
		"content-type": "application/json",
		"X-Internal-Secret": SECRET,
		"X-User-Id": "u1",
	};
}

const currentManifest = `
id: root
kind: sequential
steps:
  - agent:
      id: child
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: Say hi
`;

describe("POST /edit-agent", () => {
	it("requires authentication", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
	});

	it("rejects missing currentManifest", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/currentManifest/i);
	});

	it("rejects non-string changeDescription", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				currentManifest,
				changeDescription: 123,
			}),
		});
		expect(res.status).toBe(400);
	});

	it("rejects manifests over the size cap", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				currentManifest: "a".repeat(70_000),
				changeDescription: "change it",
			}),
		});
		expect(res.status).toBe(413);
	});

	it("rejects malformed selection paths before running the editor agent", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				currentManifest,
				changeDescription: "make the child concise",
				selection: { agentPath: ["steps", -1, "agent"] },
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/selection\.agentPath/);
	});

	it("rejects missing selected blocks before running the editor agent", async () => {
		const { app } = makeApp();
		const res = await app.request("/edit-agent", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				currentManifest,
				changeDescription: "make the child concise",
				selection: { agentPath: ["steps", 9, "agent"] },
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/selected block/i);
	});
});
