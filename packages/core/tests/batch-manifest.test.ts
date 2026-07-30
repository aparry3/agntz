import { describe, expect, it } from "vitest";
import { parseBatchManifest } from "../src/manifest/batch.js";

const VALID = `id: summarize-records
name: Summarize records
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0.2
  maxTokens: 800
instruction: Summarize the record accurately.
prompt: "Record: {{input}}"
defaultDataset:
  id: customer-records
  version: production
`;

describe("parseBatchManifest", () => {
	it("accepts the provider-native LLM subset and a versioned default dataset", () => {
		const manifest = parseBatchManifest(VALID);

		expect(manifest.id).toBe("summarize-records");
		expect(manifest.model).toMatchObject({
			provider: "openai",
			name: "gpt-5.4-mini",
			temperature: 0.2,
			maxTokens: 800,
		});
		expect(manifest.defaultDataset).toEqual({
			id: "customer-records",
			version: "production",
		});
	});

	it.each(["openai", "anthropic", "google", "mistral"])(
		"accepts the %s native provider",
		(provider) => {
			expect(
				parseBatchManifest(
					VALID.replace("provider: openai", `provider: ${provider}`),
				).model.provider,
			).toBe(provider);
		},
	);

	it.each([
		["tools", "tools:\n  - type: inline\n    name: lookup"],
		["skills", "skills:\n  - research"],
		["resources", "resources:\n  docs: {}"],
		["spawnable", "spawnable:\n  - child"],
		["reply", "reply: Working"],
		["stateKey", "stateKey: batch"],
	])("rejects runtime-only field %s", (_field, yaml) => {
		expect(() => parseBatchManifest(`${VALID}\n${yaml}\n`)).toThrow(
			"not supported",
		);
	});

	it("rejects non-LLM agents, unknown providers, and model escape hatches", () => {
		expect(() =>
			parseBatchManifest(VALID.replace("kind: llm", "kind: pipeline")),
		).toThrow("kind 'llm'");
		expect(() =>
			parseBatchManifest(VALID.replace("provider: openai", "provider: xai")),
		).toThrow("is not supported");
		expect(() =>
			parseBatchManifest(
				VALID.replace("  maxTokens: 800", "  maxTokens: 800\n  maxRetries: 2"),
			),
		).toThrow("maxRetries");
	});

	it("rejects model fields that the selected provider would otherwise ignore", () => {
		expect(() =>
			parseBatchManifest(
				VALID.replace("  maxTokens: 800", "  maxTokens: 800\n  topK: 20"),
			),
		).toThrow("openai' does not support model.topK");
		expect(() =>
			parseBatchManifest(
				VALID.replace("provider: openai", "provider: anthropic").replace(
					"  maxTokens: 800",
					"  maxTokens: 800\n  presencePenalty: 0.2",
				),
			),
		).toThrow("anthropic' does not support model.presencePenalty");
	});

	it("validates the default dataset reference strictly", () => {
		expect(() =>
			parseBatchManifest(
				VALID.replace("  version: production", "  alias: production"),
			),
		).toThrow("Unknown defaultDataset field");
		expect(() =>
			parseBatchManifest(VALID.replace("  id: customer-records", "  id: ''")),
		).toThrow("non-empty string");
	});
});
