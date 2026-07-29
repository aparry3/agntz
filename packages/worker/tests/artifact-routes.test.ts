import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { MemoryArtifactBlobStore } from "../src/artifacts.js";
import { createWorkerAPI } from "../src/routes.js";

describe("managed artifact routes", () => {
	it("uploads, scopes, downloads, signs, and deletes artifact bytes", async () => {
		const store = new MemoryStore();
		const blobs = new MemoryArtifactBlobStore();
		const app = createWorkerAPI({
			store,
			artifactBlobs: blobs,
			internalSecret: "artifact-test-secret",
		});
		const { rawKey: ownerKey } = await store
			.forUser("owner")
			.createApiKey({ userId: "owner", name: "owner" });
		const { rawKey: otherKey } = await store
			.forUser("other")
			.createApiKey({ userId: "other", name: "other" });
		const form = new FormData();
		form.append(
			"file",
			new Blob(["audio-bytes"], { type: "audio/mpeg" }),
			"sample.mp3",
		);
		form.append("expiresInSeconds", "600");

		const uploaded = await app.request("/artifacts", {
			method: "POST",
			headers: { Authorization: `Bearer ${ownerKey}` },
			body: form,
		});
		expect(uploaded.status).toBe(201);
		const artifact = await uploaded.json();
		expect(artifact).toMatchObject({
			ownerId: "owner",
			purpose: "input",
			mediaType: "audio/mpeg",
			sizeBytes: 11,
			status: "ready",
		});
		expect(artifact.id).toMatch(/^artifact_/);
		expect(artifact.downloadUrl).toContain(`/artifact-download/${artifact.id}`);

		const forbidden = await app.request(`/artifacts/${artifact.id}`, {
			headers: { Authorization: `Bearer ${otherKey}` },
		});
		expect(forbidden.status).toBe(404);

		const content = await app.request(`/artifacts/${artifact.id}/content`, {
			headers: { Authorization: `Bearer ${ownerKey}` },
		});
		expect(content.status).toBe(200);
		expect(content.headers.get("content-type")).toBe("audio/mpeg");
		expect(await content.text()).toBe("audio-bytes");

		const signedUrl = new URL(artifact.downloadUrl);
		const signed = await app.request(
			`${signedUrl.pathname}${signedUrl.search}`,
		);
		expect(signed.status).toBe(200);
		expect(await signed.text()).toBe("audio-bytes");

		const deleted = await app.request(`/artifacts/${artifact.id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${ownerKey}` },
		});
		expect(deleted.status).toBe(204);
		expect(await blobs.get("owner", artifact.id)).toBeNull();
		expect(
			(
				await app.request(`/artifacts/${artifact.id}`, {
					headers: { Authorization: `Bearer ${ownerKey}` },
				})
			).status,
		).toBe(404);
	});
});
