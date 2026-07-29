import { randomBytes } from "node:crypto";
import {
	type OutboundUrlPolicyOptions,
	fetchWithOutboundPolicy,
} from "@agntz/contracts";
import type {
	ArtifactMetadata,
	ContentBlock,
	Runner,
	TokenUsage,
	UnifiedStore,
} from "@agntz/core";
import type {
	AgentManifest,
	AgentState,
	ImageAgentManifest,
	TranscriptionAgentManifest,
} from "@agntz/core/manifest";
import { renderTemplate } from "@agntz/core/manifest";
import { createOpenAI } from "@ai-sdk/openai";
import { generateImage, experimental_transcribe as transcribe } from "ai";
import type { ArtifactBlobStore } from "./artifacts.js";
import { sha256 } from "./artifacts.js";

type ProviderOptions = Record<string, Record<string, unknown>>;

export interface HostedOperationMetadata {
	provider: string;
	requestedModel: string;
	model: string;
	usage: TokenUsage;
	responseId?: string;
	finishReason?: string;
	warnings?: string[];
}

export interface HostedOperationAdapterRequest {
	runner: Runner;
	store: UnifiedStore;
	artifactBlobs: ArtifactBlobStore;
	userId: string;
	manifest: AgentManifest;
	state: AgentState;
	content?: ContentBlock[];
	signal?: AbortSignal;
	artifactTtlSeconds?: number;
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
}

export interface HostedOperationAdapterResult {
	output: unknown;
	metadata: HostedOperationMetadata;
}

export type HostedOperationAdapter = (
	request: HostedOperationAdapterRequest,
) => Promise<HostedOperationAdapterResult>;

/**
 * Host-level adapter seam. Transcription and image generation are built in;
 * embedding, speech, moderation, realtime, and batch integrations can be
 * registered before those capabilities become stable manifest kinds.
 */
export class HostedOperationRegistry {
	private readonly adapters = new Map<string, HostedOperationAdapter>();

	register(kind: string, adapter: HostedOperationAdapter): void {
		if (!kind.trim()) throw new Error("Hosted operation kind is required");
		if (this.adapters.has(kind)) {
			throw new Error(
				`Hosted operation adapter '${kind}' is already registered`,
			);
		}
		this.adapters.set(kind, adapter);
	}

	get(kind: string): HostedOperationAdapter | undefined {
		return this.adapters.get(kind);
	}

	list(): string[] {
		return [...this.adapters.keys()].sort();
	}

	async execute(
		kind: string,
		request: HostedOperationAdapterRequest,
	): Promise<HostedOperationAdapterResult> {
		const adapter = this.adapters.get(kind);
		if (!adapter) {
			throw new Error(
				`No hosted operation adapter is registered for '${kind}'`,
			);
		}
		return adapter(request);
	}
}

export function createDefaultHostedOperationRegistry(): HostedOperationRegistry {
	const registry = new HostedOperationRegistry();
	registry.register("transcription", (request) =>
		executeHostedTranscription({
			...request,
			manifest: request.manifest as TranscriptionAgentManifest,
		}),
	);
	registry.register("image", (request) =>
		executeHostedImage({
			...request,
			manifest: request.manifest as ImageAgentManifest,
		}),
	);
	return registry;
}

type HostedOperationBaseOptions = Omit<
	HostedOperationAdapterRequest,
	"manifest" | "state"
>;

export async function executeHostedTranscription(
	options: HostedOperationBaseOptions & {
		manifest: TranscriptionAgentManifest;
		state: AgentState;
	},
): Promise<HostedOperationAdapterResult> {
	const { manifest } = options;
	const client = await createOpenAIClient(
		options.runner,
		manifest.model.provider,
	);
	const audio = await resolveAudio(
		options.content,
		options.signal,
		options.outboundUrlPolicy,
	);
	const prompt = manifest.instruction
		? renderTemplate(manifest.instruction, options.state)
		: undefined;
	const providerOptions = mergeProviderOptions(
		manifest.model.providerOptions,
		manifest.model.provider,
		{
			...(prompt ? { prompt } : {}),
			...(manifest.settings?.language
				? { language: manifest.settings.language }
				: {}),
			...(manifest.settings?.temperature !== undefined
				? { temperature: manifest.settings.temperature }
				: {}),
			...(manifest.settings?.timestampGranularities
				? {
						timestampGranularities: manifest.settings.timestampGranularities,
					}
				: {}),
		},
	);
	const result = await transcribe({
		model: client.transcription(manifest.model.name),
		audio,
		providerOptions: providerOptions as never,
		maxRetries: manifest.model.maxRetries,
		abortSignal: options.signal,
	});
	const response = result.responses[result.responses.length - 1];
	const warnings = normalizeWarnings(result.warnings);
	const output = {
		text: result.text,
		segments: result.segments,
		language: result.language,
		durationInSeconds: result.durationInSeconds,
	};
	return {
		output,
		metadata: {
			provider: manifest.model.provider,
			requestedModel: manifest.model.name,
			model: response?.modelId ?? manifest.model.name,
			usage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				model: response?.modelId ?? manifest.model.name,
			},
			finishReason: "stop",
			...(warnings.length ? { warnings } : {}),
		},
	};
}

export async function executeHostedImage(
	options: HostedOperationBaseOptions & {
		manifest: ImageAgentManifest;
		state: AgentState;
	},
): Promise<HostedOperationAdapterResult> {
	const { manifest } = options;
	const client = await createOpenAIClient(
		options.runner,
		manifest.model.provider,
	);
	const text = renderImagePrompt(manifest, options.state);
	const referenceImages = (options.content ?? [])
		.filter(
			(
				block,
			): block is Extract<ContentBlock, { type: "image"; base64: string }> =>
				block.type === "image" && "base64" in block,
		)
		.map((block) => Uint8Array.from(Buffer.from(block.base64, "base64")));
	const prompt =
		referenceImages.length > 0 ? { text, images: referenceImages } : text;
	const result = await generateImage({
		model: client.image(manifest.model.name),
		prompt,
		n: manifest.settings?.n,
		maxImagesPerCall: manifest.settings?.maxImagesPerCall,
		size: manifest.settings?.size,
		aspectRatio: manifest.settings?.aspectRatio,
		seed: manifest.settings?.seed ?? manifest.model.seed,
		providerOptions: manifest.model.providerOptions as never,
		maxRetries: manifest.model.maxRetries,
		abortSignal: options.signal,
	});

	const ttlSeconds = Math.min(
		Math.max(options.artifactTtlSeconds ?? 86_400, 60),
		31_536_000,
	);
	const artifacts = await Promise.all(
		result.images.map(async (image) => {
			const bytes = Uint8Array.from(image.uint8Array);
			const id = `artifact_${randomBytes(18).toString("base64url")}`;
			const createdAt = new Date();
			const metadata: ArtifactMetadata = {
				id,
				ownerId: options.userId,
				purpose: "output",
				mediaType: image.mediaType,
				sizeBytes: bytes.byteLength,
				sha256: sha256(bytes),
				createdAt: createdAt.toISOString(),
				expiresAt: new Date(
					createdAt.getTime() + ttlSeconds * 1000,
				).toISOString(),
				status: "ready",
			};
			try {
				await options.artifactBlobs.put(options.userId, id, bytes);
				await options.store.forUser(options.userId).putArtifact(metadata);
			} catch (error) {
				await options.artifactBlobs.delete(options.userId, id).catch(() => {});
				throw error;
			}
			return {
				artifactId: id,
				mediaType: metadata.mediaType,
				sizeBytes: metadata.sizeBytes,
				expiresAt: metadata.expiresAt,
			};
		}),
	);
	const response = result.responses[result.responses.length - 1];
	const warnings = normalizeWarnings(result.warnings);
	const inputTokens = result.usage.inputTokens ?? 0;
	const outputTokens = result.usage.outputTokens ?? 0;
	return {
		output: { artifacts },
		metadata: {
			provider: manifest.model.provider,
			requestedModel: manifest.model.name,
			model: response?.modelId ?? manifest.model.name,
			usage: {
				promptTokens: inputTokens,
				completionTokens: outputTokens,
				totalTokens: result.usage.totalTokens ?? inputTokens + outputTokens,
				model: response?.modelId ?? manifest.model.name,
			},
			finishReason: "stop",
			...(warnings.length ? { warnings } : {}),
		},
	};
}

async function createOpenAIClient(runner: Runner, provider: string) {
	if (provider !== "openai") {
		throw new Error(
			`Hosted transcription/image operations currently support provider "openai"; received "${provider}"`,
		);
	}
	const stored = await runner.providers?.getProvider(provider);
	return createOpenAI({
		apiKey: stored?.apiKey ?? process.env.OPENAI_API_KEY,
		baseURL: stored?.baseUrl,
	});
}

async function resolveAudio(
	content: ContentBlock[] | undefined,
	signal: AbortSignal | undefined,
	outboundUrlPolicy: OutboundUrlPolicyOptions | undefined,
): Promise<Uint8Array> {
	const blocks = (content ?? []).filter((block) => block.type === "audio");
	if (blocks.length !== 1) {
		throw new Error(
			`Transcription requires exactly one audio content block; received ${blocks.length}`,
		);
	}
	const audio = blocks[0];
	if ("base64" in audio) {
		return Uint8Array.from(Buffer.from(audio.base64, "base64"));
	}
	if ("url" in audio) {
		const response = await fetchWithOutboundPolicy(
			audio.url,
			{
				headers: audio.headers,
				signal,
			},
			{ policy: outboundUrlPolicy },
		);
		if (!response.ok) {
			throw new Error(`Audio download failed with HTTP ${response.status}`);
		}
		const declared = Number(response.headers.get("content-length") ?? "0");
		if (declared > 50 * 1024 * 1024) {
			throw new Error("Audio exceeds the 50 MiB transcription limit");
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > 50 * 1024 * 1024) {
			throw new Error("Audio exceeds the 50 MiB transcription limit");
		}
		return bytes;
	}
	throw new Error(
		"Audio artifact was not resolved; upload it through the Agntz artifact API",
	);
}

function renderImagePrompt(
	manifest: ImageAgentManifest,
	state: AgentState,
): string {
	const rendered = manifest.prompt
		? renderTemplate(manifest.prompt, state)
		: typeof state.userQuery === "string"
			? state.userQuery
			: JSON.stringify(state.userQuery ?? state);
	return manifest.instruction
		? `${renderTemplate(manifest.instruction, state)}\n\n${rendered}`
		: rendered;
}

function mergeProviderOptions(
	options: Record<string, Record<string, unknown>> | undefined,
	provider: string,
	additions: Record<string, unknown>,
): ProviderOptions | undefined {
	const merged = {
		...(options ?? {}),
		[provider]: {
			...(options?.[provider] ?? {}),
			...additions,
		},
	};
	return merged as ProviderOptions;
}

function normalizeWarnings(
	warnings: Array<{ message?: string; type?: string }> | undefined,
): string[] {
	return (warnings ?? []).map(
		(warning) =>
			warning.message ??
			(warning.type ? String(warning.type) : JSON.stringify(warning)),
	);
}
