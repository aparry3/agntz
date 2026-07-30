import { anthropicBatchAdapter } from "./anthropic.js";
import { googleBatchAdapter } from "./google.js";
import { mistralBatchAdapter } from "./mistral.js";
import { openAIBatchAdapter } from "./openai.js";
import type { BatchProviderRegistry } from "./types.js";

export type {
	BatchProviderAdapter,
	BatchProviderLimits,
	BatchProviderRegistry,
	PreparedBatchRequest,
	ProviderBatchResult,
	ProviderBatchState,
	ProviderBatchSubmission,
} from "./types.js";
export { prepareBatchRequests } from "./common.js";
export {
	cancelBatchRun,
	reconcileBatchRuns,
	submitBatchRun,
} from "./service.js";
export type { SubmitBatchRunInput } from "./service.js";

export function createDefaultBatchProviderRegistry(): BatchProviderRegistry {
	return {
		openai: openAIBatchAdapter,
		anthropic: anthropicBatchAdapter,
		google: googleBatchAdapter,
		mistral: mistralBatchAdapter,
	};
}
