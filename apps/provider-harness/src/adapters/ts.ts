import { randomUUID } from "node:crypto";
import {
	AISDKModelProvider,
	MemoryStore,
	createRunner,
	defineAgent,
	defineTool,
} from "@agntz/core";
import type { ContentBlock, ToolCallRecord } from "@agntz/core";
import { z } from "zod";
import type {
	HarnessGenerateTextOptions,
	HarnessGenerateTextResult,
	HarnessMessage,
	HarnessStreamTextResult,
	ProviderAdapter,
} from "../types.js";

const provider = new AISDKModelProvider();
const badKeyProvider = new AISDKModelProvider({
	providerStore: {
		async getProvider(id: string) {
			return { id, apiKey: "invalid-agntz-harness-negative-test-key" };
		},
		async listProviders() {
			return [];
		},
		async putProvider() {},
		async deleteProvider() {},
	},
});

export const tsAdapter: ProviderAdapter = {
	sdk: "ts",
	async generateText(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessGenerateTextResult> {
		return runThroughRuntime(options);
	},
	async streamText(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessStreamTextResult> {
		const runtime = await buildRuntime(options);
		const stream = runtime.runner.stream(runtime.agentId, runtime.input, {
			sessionId: runtime.sessionId,
			signal: options.signal,
		});

		const textStream = (async function* () {
			for await (const event of stream) {
				if (event.type === "text-delta") yield event.text;
			}
		})();

		const result = stream.result;
		return {
			textStream,
			toolCalls: result.then((r) =>
				r.toolCalls.map((tc) => ({
					id: tc.id,
					name: tc.name,
					args: tc.input,
				})),
			),
			usage: result.then((r) => r.usage),
			finishReason: result.then(() => "completed"),
			responseMessages: Promise.resolve(undefined),
		};
	},
};

async function runThroughRuntime(
	options: HarnessGenerateTextOptions,
): Promise<HarnessGenerateTextResult> {
	const runtime = await buildRuntime(options);
	const result = await runtime.runner.invoke(runtime.agentId, runtime.input, {
		sessionId: runtime.sessionId,
		signal: options.signal,
	});
	const sessionMessages = await runtime.store.getMessages(result.sessionId);
	return {
		text:
			typeof result.output === "string"
				? result.output
				: JSON.stringify(result.output),
		toolCalls: result.toolCalls.map((tc) => ({
			id: tc.id,
			name: tc.name,
			args: tc.input,
		})),
		usage: result.usage,
		finishReason: "completed",
		sessionMessages: sessionMessages.map((message) => ({
			role: message.role,
			content: message.content,
			...(message.toolCalls
				? {
						tool_calls: message.toolCalls.map((toolCall) => ({
							id: toolCall.id,
							name: toolCall.name,
							input: toolCall.input,
							output: toolCall.output,
							duration: toolCall.duration,
							...(toolCall.error ? { error: toolCall.error } : {}),
						})),
					}
				: {}),
			...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
		})),
	};
}

async function buildRuntime(options: HarnessGenerateTextOptions) {
	const store = new MemoryStore();
	const runner = createRunner({
		store,
		modelProvider: options.invalidApiKey ? badKeyProvider : provider,
		tools: createRuntimeTools(options),
	});
	const agentId = "provider-harness";
	const sessionId = `provider-harness-${randomUUID()}`;
	const { systemPrompt, priorMessages, input } = splitRuntimeMessages(
		options.messages,
	);
	await store.getOrCreateSession(sessionId);
	if (priorMessages.length > 0) {
		await store.append(
			sessionId,
			priorMessages.map((message) => ({
				role: message.role as "user" | "assistant" | "tool",
				content: toRuntimeContent(message.content),
				...(message.tool_calls
					? { toolCalls: message.tool_calls as unknown as ToolCallRecord[] }
					: {}),
				...(message.tool_call_id
					? { toolCallId: String(message.tool_call_id) }
					: {}),
				timestamp: new Date().toISOString(),
			})),
		);
	}
	runner.registerAgent(
		defineAgent({
			id: agentId,
			name: "Provider Harness",
			systemPrompt,
			model: {
				provider: options.model.provider,
				name: options.model.name,
				maxTokens: options.maxTokens,
			},
			tools: options.tools?.map((tool) => ({
				type: "inline" as const,
				name: tool.name,
			})),
			outputSchema: options.outputSchema?.schema,
		}),
	);
	return { runner, store, agentId, sessionId, input };
}

function splitRuntimeMessages(messages: readonly HarnessMessage[]): {
	systemPrompt: string;
	priorMessages: HarnessMessage[];
	input: string | ContentBlock[];
} {
	const systemPrompt = messages
		.filter((message) => message.role === "system")
		.map((message) => String(message.content))
		.join("\n\n");
	const nonSystem = messages.filter((message) => message.role !== "system");
	let finalUserIndex = -1;
	for (let index = 0; index < nonSystem.length; index++) {
		if (nonSystem[index].role === "user") finalUserIndex = index;
	}
	if (finalUserIndex === -1) {
		throw new Error("runtime harness requires a final user message");
	}
	const finalUser = nonSystem[finalUserIndex];
	return {
		systemPrompt: systemPrompt || "You are a concise test assistant.",
		priorMessages: nonSystem.slice(0, finalUserIndex),
		input: toRuntimeContent(finalUser.content),
	};
}

function toRuntimeContent(content: unknown): string | ContentBlock[] {
	if (!Array.isArray(content)) return String(content ?? "");
	return content.map((part) => {
		if (
			part &&
			typeof part === "object" &&
			"type" in part &&
			part.type === "image" &&
			"image" in part &&
			typeof part.image === "string"
		) {
			if (part.image.startsWith("data:")) {
				const match = part.image.match(/^data:([^;]+);base64,(.*)$/);
				if (match) {
					return {
						type: "image",
						mediaType: match[1],
						base64: match[2],
					} satisfies ContentBlock;
				}
			}
			return { type: "image", url: part.image } satisfies ContentBlock;
		}
		return part as ContentBlock;
	});
}

function createRuntimeTools(options: HarnessGenerateTextOptions) {
	return (options.tools ?? []).map((tool) =>
		defineTool({
			name: tool.name,
			description: tool.description,
			input: z.object({ city: z.string().optional() }).passthrough(),
			async execute(input) {
				const city =
					typeof input === "object" && input && "city" in input
						? String(input.city)
						: "unknown";
				return { forecast: "18°C and sunny", city };
			},
		}),
	);
}
