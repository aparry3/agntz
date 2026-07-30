import type { DatasetRef } from "@agntz/contracts";
import { parse as parseYAML } from "yaml";
import { parseManifest } from "./parser.js";
import type { LLMAgentManifest } from "./types.js";

export const BATCH_PROVIDERS = [
	"openai",
	"anthropic",
	"google",
	"mistral",
] as const;

export type BatchProvider = (typeof BATCH_PROVIDERS)[number];

export interface BatchManifest extends LLMAgentManifest {
	defaultDataset?: DatasetRef;
}

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
	"id",
	"name",
	"description",
	"kind",
	"model",
	"instruction",
	"prompt",
	"examples",
	"inputSchema",
	"outputSchema",
	"defaultDataset",
]);

const PROHIBITED_FIELDS = new Map<string, string>([
	["tools", "provider-native batches cannot execute tools"],
	["skills", "provider-native batches cannot load skills"],
	["resources", "provider-native batches cannot access resources"],
	["spawnable", "provider-native batches cannot spawn agents"],
	["reply", "provider-native batches cannot send intermediate replies"],
	["stateKey", "state is a runtime-only agent feature"],
	["maxSteps", "provider-native batches perform one model request per item"],
	["tokenBudget", "token budgets are enforced by the interactive runtime"],
	["timeoutMs", "batch duration is controlled by the provider"],
	["retention", "batch results are retained until the batch run is deleted"],
]);

/**
 * Parse the strict, provider-native subset of an Agntz `kind: llm` manifest.
 * The regular manifest parser remains the source of truth for core LLM fields;
 * this layer only narrows features that cannot execute in a provider batch.
 */
export function parseBatchManifest(yaml: string): BatchManifest {
	const parsed = parseYAML(yaml);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Batch manifest must be a YAML object");
	}
	const raw = parsed as Record<string, unknown>;
	for (const field of Object.keys(raw)) {
		const prohibited = PROHIBITED_FIELDS.get(field);
		if (prohibited) {
			throw new Error(
				`Batch manifest field '${field}' is not supported: ${prohibited}`,
			);
		}
		if (!ALLOWED_TOP_LEVEL_FIELDS.has(field)) {
			throw new Error(`Unknown batch manifest field '${field}'`);
		}
	}
	if (raw.kind !== "llm") {
		throw new Error(
			`Batch manifest must use kind 'llm' (received '${String(raw.kind)}')`,
		);
	}

	const manifest = parseManifest(yaml);
	if (manifest.kind !== "llm") {
		throw new Error("Batch manifest must use kind 'llm'");
	}
	if (!BATCH_PROVIDERS.includes(manifest.model.provider as BatchProvider)) {
		throw new Error(
			`Batch provider '${manifest.model.provider}' is not supported; expected ${BATCH_PROVIDERS.join(", ")}`,
		);
	}
	if (
		manifest.model.maxRetries !== undefined ||
		manifest.model.providerOptions !== undefined ||
		manifest.model.options !== undefined
	) {
		throw new Error(
			"Batch model cannot use maxRetries, providerOptions, or legacy options",
		);
	}
	const unsupportedModelFields: Record<BatchProvider, string[]> = {
		openai: [
			"topK",
			"presencePenalty",
			"frequencyPenalty",
			"stopSequences",
			"seed",
		],
		anthropic: ["presencePenalty", "frequencyPenalty", "seed"],
		google: [],
		mistral: ["topK"],
	};
	for (const field of unsupportedModelFields[
		manifest.model.provider as BatchProvider
	]) {
		if (manifest.model[field as keyof typeof manifest.model] !== undefined) {
			throw new Error(
				`Batch provider '${manifest.model.provider}' does not support model.${field}`,
			);
		}
	}

	return {
		...manifest,
		defaultDataset: normalizeDatasetRef(raw.defaultDataset),
	};
}

function normalizeDatasetRef(value: unknown): DatasetRef | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("'defaultDataset' must be an object with an id");
	}
	const ref = value as Record<string, unknown>;
	if (typeof ref.id !== "string" || ref.id.trim().length === 0) {
		throw new Error("'defaultDataset.id' must be a non-empty string");
	}
	if (ref.version !== undefined && typeof ref.version !== "string") {
		throw new Error("'defaultDataset.version' must be a string");
	}
	for (const field of Object.keys(ref)) {
		if (field !== "id" && field !== "version") {
			throw new Error(`Unknown defaultDataset field '${field}'`);
		}
	}
	return {
		id: ref.id,
		...(ref.version ? { version: ref.version } : {}),
	};
}
