import { createRunner } from "@agntz/core";
import type {
	AgentManifest,
	ImageAgentManifest,
	TranscriptionAgentManifest,
} from "@agntz/core/manifest";
import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it, vi } from "vitest";
import { HostedOperationRegistry } from "../src/model-operations.js";
import { createWorkerAPI } from "../src/routes.js";

const manifests: Record<string, AgentManifest> = {
	transcribe: {
		id: "transcribe",
		kind: "transcription",
		model: { provider: "custom", name: "speech-v1" },
		instruction: "Preserve quantities.",
	} satisfies TranscriptionAgentManifest,
	cover: {
		id: "cover",
		kind: "image",
		model: { provider: "custom", name: "image-v1" },
		prompt: "Cover for {{userQuery}}",
	} satisfies ImageAgentManifest,
};

describe("unified hosted operation routes", () => {
	it("dispatches transcription and image manifests through agents.run", async () => {
		const store = new MemoryStore();
		const operations = new HostedOperationRegistry();
		const transcription = vi.fn(async () => ({
			output: { text: "two tablespoons" },
			metadata: {
				provider: "custom",
				requestedModel: "speech-v1",
				model: "speech-v1.1",
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				finishReason: "stop",
			},
		}));
		const image = vi.fn(async () => ({
			output: {
				artifacts: [
					{
						artifactId: "artifact_generated123",
						mediaType: "image/png",
						sizeBytes: 4,
					},
				],
			},
			metadata: {
				provider: "custom",
				requestedModel: "image-v1",
				model: "image-v1.2",
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
				finishReason: "stop",
			},
		}));
		operations.register("transcription", transcription);
		operations.register("image", image);
		const app = createWorkerAPI({
			store,
			internalSecret: "test-secret",
			modelOperations: operations,
			resolveRunnerAndManifest: async (unified, userId, agentId) => ({
				runner: createRunner({ store: unified.forUser(userId) }),
				manifest: manifests[agentId]!,
			}),
		});
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });
		const headers = {
			Authorization: `Bearer ${rawKey}`,
			"Content-Type": "application/json",
		};

		const transcriptResponse = await app.request("/run", {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "transcribe",
				content: [
					{ type: "audio", base64: "YXVkaW8=", mediaType: "audio/mpeg" },
				],
				retention: { mode: "none" },
			}),
		});
		expect(transcriptResponse.status).toBe(200);
		expect(await transcriptResponse.json()).toMatchObject({
			output: { text: "two tablespoons" },
			provider: "custom",
			model: "speech-v1.1",
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		});
		expect(transcription).toHaveBeenCalledWith(
			expect.objectContaining({
				manifest: expect.objectContaining({ kind: "transcription" }),
				content: [
					{ type: "audio", base64: "YXVkaW8=", mediaType: "audio/mpeg" },
				],
			}),
		);

		const imageResponse = await app.request("/run", {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "cover",
				input: "tomato soup",
				retention: { mode: "result" },
			}),
		});
		expect(imageResponse.status).toBe(200);
		expect(await imageResponse.json()).toMatchObject({
			output: {
				artifacts: [
					{
						artifactId: "artifact_generated123",
						mediaType: "image/png",
					},
				],
			},
			model: "image-v1.2",
			usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 },
		});
		expect(image).toHaveBeenCalledOnce();
	});
});
