import { AISDKModelProvider } from "@agntz/core";
import type {
	HarnessGenerateTextOptions,
	HarnessGenerateTextResult,
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
		const target = options.invalidApiKey ? badKeyProvider : provider;
		const result = await target.generateText({
			model: options.model,
			messages: options.messages,
			tools: options.tools ? [...options.tools] : undefined,
			outputSchema: options.outputSchema,
			maxTokens: options.maxTokens,
			signal: options.signal,
		});
		return result;
	},
	async streamText(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessStreamTextResult> {
		return provider.streamText({
			model: options.model,
			messages: options.messages,
			tools: options.tools ? [...options.tools] : undefined,
			outputSchema: options.outputSchema,
			maxTokens: options.maxTokens,
			signal: options.signal,
		});
	},
};
