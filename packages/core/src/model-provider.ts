import type { ModelConfig, ModelProvider, GenerateTextOptions, GenerateTextResult, ModelStreamResult, TokenUsage, ProviderStore, ProviderConfig } from "./types.js";

/**
 * Default model provider using the Vercel AI SDK (`ai` package).
 * Checks the ProviderStore for API keys first, then falls back to env vars.
 */
export class AISDKModelProvider implements ModelProvider {
  private providerStore?: ProviderStore;

  constructor(options?: { providerStore?: ProviderStore }) {
    this.providerStore = options?.providerStore;
  }
  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const { generateText, Output, jsonSchema } = await import("ai");
    const model = await this.resolveModel(options.model);

    const messages = options.messages.map(m => ({
      role: m.role as "system" | "user" | "assistant" | "tool",
      content: m.content,
    }));

    // Build tools map for the AI SDK
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};
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

    const experimental_output = options.outputSchema
      ? Output.object({
          name: options.outputSchema.name,
          schema: jsonSchema(options.outputSchema.schema as Parameters<typeof jsonSchema>[0]),
        })
      : undefined;

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        experimental_output,
        maxOutputTokens: options.maxTokens,
        abortSignal: options.signal,
      });
    } catch (err) {
      logLlmCallFailure("generateText", options.model, messages, tools, err);
      throw err;
    }

    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;

    return {
      text: result.text ?? "",
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        args: tc.input,
      })),
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: result.finishReason ?? "stop",
    };
  }

  async streamText(options: GenerateTextOptions): Promise<ModelStreamResult> {
    const { streamText, Output, jsonSchema } = await import("ai");
    const model = await this.resolveModel(options.model);

    const messages = options.messages.map(m => ({
      role: m.role as "system" | "user" | "assistant" | "tool",
      content: m.content,
    }));

    // Build tools map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = {};
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

    const experimental_output = options.outputSchema
      ? Output.object({
          name: options.outputSchema.name,
          schema: jsonSchema(options.outputSchema.schema as Parameters<typeof jsonSchema>[0]),
        })
      : undefined;

    let result: ReturnType<typeof streamText>;
    try {
      result = streamText({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: Object.keys(tools).length > 0 ? tools : undefined,
        experimental_output,
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
      logLlmCallFailure("streamText[deferred]", options.model, messages, tools, err);
    });

    const toolCallsPromise = Promise.resolve(result.toolCalls).then(tcs =>
      tcs.map(tc => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input }))
    );
    const usagePromise = Promise.resolve(result.usage).then(u => {
      const inputTokens = u?.inputTokens ?? 0;
      const outputTokens = u?.outputTokens ?? 0;
      return {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    });
    const finishReasonPromise = Promise.resolve(result.finishReason) as Promise<string>;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async resolveModel(config: ModelConfig): Promise<any> {
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
      default:
        throw new Error(
          `Unknown model provider "${provider}". ` +
          `Supported: openai, anthropic, google, mistral, xai, groq, deepseek, perplexity, cohere, azure. ` +
          `For other providers, pass a custom modelProvider to createRunner().`
        );
    }
  }

  /**
   * Get provider config from the store, falling back to env vars.
   */
  private async getProviderConfig(provider: string): Promise<ProviderConfig | undefined> {
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
    };
    return ENV_MAP[provider];
  }
}

/**
 * Convert a JSON Schema object to a basic Zod schema.
 * This is a simplified conversion for passing tool parameters to the AI SDK.
 */
function jsonSchemaToZod(schema: Record<string, unknown>, z: typeof import("zod").z): import("zod").ZodSchema {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
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

function logLlmCallFailure(
  site: string,
  model: ModelConfig,
  messages: Array<{ role: string; content: unknown }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>,
  err: unknown,
): void {
  const e = err as Error & { cause?: unknown };
  const summary = messages.map((m, i) => {
    const c = m.content;
    if (typeof c === "string") {
      return `  [${i}] role=${m.role} type=string len=${c.length} preview=${JSON.stringify(c.slice(0, 120))}`;
    }
    return `  [${i}] role=${m.role} type=${Array.isArray(c) ? "array" : typeof c} value=${JSON.stringify(c)?.slice(0, 240)}`;
  }).join("\n");
  console.error(
    `[model-provider] ${site} failed model=${model.provider}/${model.name}: ${e?.message}\n` +
    `tools=[${Object.keys(tools).join(",")}]\n` +
    `messages (${messages.length}):\n${summary}` +
    (e?.cause ? `\ncause=${JSON.stringify(e.cause)?.slice(0, 400)}` : "") +
    (e?.stack ? `\nstack=${e.stack}` : "")
  );
}
