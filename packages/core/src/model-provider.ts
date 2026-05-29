import type { JSONValue, LanguageModel, ModelMessage, ToolSet } from "ai";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelConfig,
	ModelProvider,
	ModelStreamResult,
	ProviderConfig,
	ProviderStore,
	TokenUsage,
} from "./types.js";

type AiOutput = typeof import("ai").Output;
type AiJsonSchema = typeof import("ai").jsonSchema;
type AiGenerateTextOptions = Parameters<typeof import("ai").generateText>[0];
type AiStructuredOutputConfig = Pick<
	AiGenerateTextOptions,
	"experimental_output" | "providerOptions"
>;

/**
 * Default model provider using the Vercel AI SDK (`ai` package).
 * Checks the ProviderStore for API keys first, then falls back to env vars.
 */
export class AISDKModelProvider implements ModelProvider {
	private providerStore?: ProviderStore;

	constructor(options?: { providerStore?: ProviderStore }) {
		this.providerStore = options?.providerStore;
	}
	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		const { generateText, Output, jsonSchema } = await import("ai");
		const model = await this.resolveModel(options.model);

		const messages = options.messages.map((m) => ({
			role: m.role as "system" | "user" | "assistant" | "tool",
			content: m.content,
		})) as ModelMessage[];

		// Build tools map for the AI SDK
		const tools: ToolSet = {};
		if (options.tools?.length) {
			const { tool: aiTool } = await import("ai");
			const { z } = await import("zod");

			for (const t of options.tools) {
				tools[t.name] = aiTool({
					description: t.description,
					inputSchema: jsonSchemaToZod(t.parameters, z),
				});
			}
		}

		const { experimental_output, providerOptions } = buildStructuredOutput(
			options,
			Output,
			jsonSchema,
		);

		let result: Awaited<ReturnType<typeof generateText>>;
		try {
			result = await generateText({
				model,
				messages,
				tools: Object.keys(tools).length > 0 ? tools : undefined,
				experimental_output,
				providerOptions,
				maxOutputTokens: options.maxTokens,
				abortSignal: options.signal,
			});
		} catch (err) {
			logLlmCallFailure("generateText", options.model, messages, tools, err);
			throw err;
		}

		const inputTokens = result.usage?.inputTokens ?? 0;
		const outputTokens = result.usage?.outputTokens ?? 0;
		const cost = extractProviderCost(result.providerMetadata);

		return {
			text: finalizeText(result.text ?? "", options),
			toolCalls: result.toolCalls?.map((tc) => ({
				id: tc.toolCallId,
				name: tc.toolName,
				args: tc.input,
				providerMetadata: tc.providerMetadata,
			})),
			usage: {
				promptTokens: inputTokens,
				completionTokens: outputTokens,
				totalTokens: inputTokens + outputTokens,
				...(cost !== undefined ? { cost } : {}),
			},
			finishReason: result.finishReason ?? "stop",
		};
	}

	async streamText(options: GenerateTextOptions): Promise<ModelStreamResult> {
		const { streamText, Output, jsonSchema } = await import("ai");
		const model = await this.resolveModel(options.model);

		const messages = options.messages.map((m) => ({
			role: m.role as "system" | "user" | "assistant" | "tool",
			content: m.content,
		})) as ModelMessage[];

		// Build tools map
		const tools: ToolSet = {};
		if (options.tools?.length) {
			const { tool: aiTool } = await import("ai");
			const { z } = await import("zod");

			for (const t of options.tools) {
				tools[t.name] = aiTool({
					description: t.description,
					inputSchema: jsonSchemaToZod(t.parameters, z),
				});
			}
		}

		const { experimental_output, providerOptions } = buildStructuredOutput(
			options,
			Output,
			jsonSchema,
		);

		let result: ReturnType<typeof streamText>;
		try {
			result = streamText({
				model,
				messages,
				tools: Object.keys(tools).length > 0 ? tools : undefined,
				experimental_output,
				providerOptions,
				maxOutputTokens: options.maxTokens,
				abortSignal: options.signal,
			});
		} catch (err) {
			logLlmCallFailure("streamText", options.model, messages, tools, err);
			throw err;
		}
		// Deferred schema validation / provider errors surface via the result
		// promises rather than the synchronous call above. Attach a diagnostic
		// logger so we see the messages payload when that happens too.
		Promise.resolve(result.finishReason).catch((err) => {
			logLlmCallFailure(
				"streamText[deferred]",
				options.model,
				messages,
				tools,
				err,
			);
		});

		const toolCallsPromise = Promise.resolve(result.toolCalls).then((tcs) =>
			tcs.map((tc) => ({
				id: tc.toolCallId,
				name: tc.toolName,
				args: tc.input,
				providerMetadata: tc.providerMetadata,
			})),
		);
		const usagePromise = Promise.resolve(result.usage).then(async (u) => {
			const inputTokens = u?.inputTokens ?? 0;
			const outputTokens = u?.outputTokens ?? 0;
			const cost = extractProviderCost(
				await Promise.resolve(result.providerMetadata).catch(() => undefined),
			);
			return {
				promptTokens: inputTokens,
				completionTokens: outputTokens,
				totalTokens: inputTokens + outputTokens,
				...(cost !== undefined ? { cost } : {}),
			};
		});
		const finishReasonPromise = Promise.resolve(
			result.finishReason,
		) as Promise<string>;

		return {
			textStream: result.textStream,
			toolCalls: toolCallsPromise,
			usage: usagePromise,
			finishReason: finishReasonPromise,
			async toResult(): Promise<GenerateTextResult> {
				const text = await result.text;
				const toolCalls = await toolCallsPromise;
				const usage = await usagePromise;
				const finishReason = await finishReasonPromise;
				return { text, toolCalls, usage, finishReason };
			},
		};
	}

	private async resolveModel(config: ModelConfig): Promise<LanguageModel> {
		const { provider, name } = config;

		// Look up provider config from store (API key, base URL)
		const providerConfig = await this.getProviderConfig(provider);
		const apiKey = providerConfig?.apiKey;
		const baseURL = providerConfig?.baseUrl;

		switch (provider) {
			case "openai": {
				const { createOpenAI } = await import("@ai-sdk/openai");
				const client = createOpenAI({ apiKey, baseURL });
				return client(name);
			}
			case "anthropic": {
				const { createAnthropic } = await import("@ai-sdk/anthropic");
				const client = createAnthropic({ apiKey, baseURL });
				return client(name);
			}
			case "google": {
				const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
				const client = createGoogleGenerativeAI({ apiKey, baseURL });
				return client(name);
			}
			case "mistral": {
				const { createMistral } = await import("@ai-sdk/mistral");
				const client = createMistral({ apiKey, baseURL });
				return client(name);
			}
			case "xai": {
				const { createXai } = await import("@ai-sdk/xai");
				const client = createXai({ apiKey, baseURL });
				return client(name);
			}
			case "groq": {
				const { createGroq } = await import("@ai-sdk/groq");
				const client = createGroq({ apiKey, baseURL });
				return client(name);
			}
			case "deepseek": {
				const { createDeepSeek } = await import("@ai-sdk/deepseek");
				const client = createDeepSeek({ apiKey, baseURL });
				return client(name);
			}
			case "perplexity": {
				const { createPerplexity } = await import("@ai-sdk/perplexity");
				const client = createPerplexity({ apiKey, baseURL });
				return client(name);
			}
			case "cohere": {
				const { createCohere } = await import("@ai-sdk/cohere");
				const client = createCohere({ apiKey, baseURL });
				return client(name);
			}
			case "azure": {
				const { createAzure } = await import("@ai-sdk/azure");
				const client = createAzure({ apiKey, baseURL });
				return client(name);
			}
			case "openrouter": {
				const { createOpenRouter } = await import(
					"@openrouter/ai-sdk-provider"
				);
				const cfg = providerConfig?.config as
					| {
							referer?: string;
							title?: string;
							headers?: Record<string, string>;
					  }
					| undefined;
				const headers = {
					"HTTP-Referer": cfg?.referer ?? "https://agntz.co",
					"X-Title": cfg?.title ?? "agntz",
					...(cfg?.headers ?? {}),
				};
				const client = createOpenRouter({ apiKey, baseURL, headers });
				return client(name, { extraBody: { usage: { include: true } } });
			}
			default:
				throw new Error(
					`Unknown model provider "${provider}". Supported: openai, anthropic, google, mistral, xai, groq, deepseek, perplexity, cohere, azure, openrouter. For other providers, pass a custom modelProvider to createRunner().`,
				);
		}
	}

	/**
	 * Get provider config from the store, falling back to env vars.
	 */
	private async getProviderConfig(
		provider: string,
	): Promise<ProviderConfig | undefined> {
		// Check store first
		if (this.providerStore) {
			const stored = await this.providerStore.getProvider(provider);
			if (stored?.apiKey) return stored;
		}

		// Fall back to env vars
		const envKey = this.getEnvVarForProvider(provider);
		const apiKey = envKey ? process.env[envKey] : undefined;
		if (apiKey) {
			return { id: provider, apiKey };
		}

		// No config found — the SDK will throw its own error about missing API key
		return undefined;
	}

	private getEnvVarForProvider(provider: string): string | undefined {
		const ENV_MAP: Record<string, string> = {
			openai: "OPENAI_API_KEY",
			anthropic: "ANTHROPIC_API_KEY",
			google: "GOOGLE_GENERATIVE_AI_API_KEY",
			mistral: "MISTRAL_API_KEY",
			xai: "XAI_API_KEY",
			groq: "GROQ_API_KEY",
			deepseek: "DEEPSEEK_API_KEY",
			perplexity: "PERPLEXITY_API_KEY",
			cohere: "COHERE_API_KEY",
			azure: "AZURE_OPENAI_API_KEY",
			openrouter: "OPENROUTER_API_KEY",
		};
		return ENV_MAP[provider];
	}
}

/**
 * Convert a JSON Schema object to a basic Zod schema.
 * This is a simplified conversion for passing tool parameters to the AI SDK.
 */
// Structured-output config. The AI SDK's generic experimental_output (and
// generateObject) break on Gemini — truncated text / "could not parse" — whether
// reached directly or via OpenRouter. Each transport's *native* structured-output
// mechanism is reliable, so route google and openrouter through providerOptions;
// every other provider keeps experimental_output, which works for them.
function buildStructuredOutput(
	options: GenerateTextOptions,
	Output: AiOutput,
	jsonSchema: AiJsonSchema,
): AiStructuredOutputConfig {
	if (!options.outputSchema)
		return { experimental_output: undefined, providerOptions: undefined };
	if (options.model.provider === "google") {
		return {
			experimental_output: undefined,
			providerOptions: {
				google: {
					responseMimeType: "application/json",
					responseSchema: options.outputSchema.schema as JSONValue,
				},
			},
		};
	}
	if (options.model.provider === "openrouter") {
		return {
			experimental_output: undefined,
			providerOptions: {
				openrouter: {
					responseFormat: {
						type: "json_schema",
						json_schema: {
							name: options.outputSchema.name,
							strict: true,
							schema: options.outputSchema.schema as JSONValue,
						},
					},
				},
			},
		};
	}
	return {
		experimental_output: Output.object({
			name: options.outputSchema.name,
			schema: jsonSchema(options.outputSchema.schema),
		}),
		providerOptions: undefined,
	};
}

// The native structured-output paths (google, openrouter) sometimes wrap the JSON
// in a markdown fence or a short prose preamble. Extract the JSON so callers get
// clean parseable text. Providers on the experimental_output path already return
// clean JSON, so this only runs for the native paths.
function finalizeText(text: string, options: GenerateTextOptions): string {
	if (
		options.outputSchema &&
		(options.model.provider === "google" ||
			options.model.provider === "openrouter")
	) {
		return extractJsonText(text);
	}
	return text;
}

function extractJsonText(text: string): string {
	const t = text.trim();
	try {
		JSON.parse(t);
		return t;
	} catch {
		/* not already-clean JSON */
	}
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) {
		const inner = fence[1].trim();
		try {
			JSON.parse(inner);
			return inner;
		} catch {
			/* keep looking */
		}
	}
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start !== -1 && end > start) {
		const cand = t.slice(start, end + 1);
		try {
			JSON.parse(cand);
			return cand;
		} catch {
			/* give up */
		}
	}
	return text;
}

function jsonSchemaToZod(
	schema: Record<string, unknown>,
	z: typeof import("zod").z,
): import("zod").ZodSchema {
	if (!schema || schema.type !== "object") {
		return z.object({});
	}

	const properties = (schema.properties ?? {}) as Record<
		string,
		Record<string, unknown>
	>;
	const required = (schema.required ?? []) as string[];
	const shape: Record<string, import("zod").ZodSchema> = {};

	for (const [key, prop] of Object.entries(properties)) {
		let field: import("zod").ZodSchema;

		switch (prop.type) {
			case "string":
				if (prop.enum) {
					field = z.enum(prop.enum as [string, ...string[]]);
				} else {
					field = z.string();
				}
				break;
			case "number":
				field = z.number();
				break;
			case "boolean":
				field = z.boolean();
				break;
			case "array":
				field = z.array(z.unknown());
				break;
			case "object":
				field = z.record(z.unknown());
				break;
			default:
				field = z.unknown();
		}

		if (!required.includes(key)) {
			field = field.optional() as unknown as import("zod").ZodSchema;
		}

		if (prop.description) {
			field = field.describe(prop.description as string);
		}

		shape[key] = field;
	}

	return z.object(shape);
}

/**
 * Extract per-call cost (USD) from provider response metadata. OpenRouter reports
 * cost under `providerMetadata.openrouter.usage.cost` when `extraBody.usage.include`
 * is set. Returns undefined when no cost is reported.
 */
function extractProviderCost(metadata: unknown): number | undefined {
	if (!metadata || typeof metadata !== "object") return undefined;
	const meta = metadata as Record<string, unknown>;
	for (const provider of Object.keys(meta)) {
		const entry = meta[provider];
		if (!entry || typeof entry !== "object") continue;
		const usage = (entry as Record<string, unknown>).usage;
		if (!usage || typeof usage !== "object") continue;
		const cost = (usage as Record<string, unknown>).cost;
		if (typeof cost === "number" && Number.isFinite(cost)) return cost;
	}
	return undefined;
}

function logLlmCallFailure(
	site: string,
	model: ModelConfig,
	messages: Array<{ role: string; content: unknown }>,
	tools: ToolSet,
	err: unknown,
): void {
	const e = err as Error & { cause?: unknown };
	const summary = messages
		.map((m, i) => {
			const c = m.content;
			if (typeof c === "string") {
				return `  [${i}] role=${m.role} type=string len=${c.length} preview=${JSON.stringify(c.slice(0, 120))}`;
			}
			return `  [${i}] role=${m.role} type=${Array.isArray(c) ? "array" : typeof c} value=${JSON.stringify(c)?.slice(0, 240)}`;
		})
		.join("\n");
	console.error(
		`[model-provider] ${site} failed model=${model.provider}/${model.name}: ${e?.message}\ntools=[${Object.keys(tools).join(",")}]\nmessages (${messages.length}):\n${summary}${e?.cause ? `\ncause=${JSON.stringify(e.cause)?.slice(0, 400)}` : ""}${e?.stack ? `\nstack=${e.stack}` : ""}`,
	);
}
