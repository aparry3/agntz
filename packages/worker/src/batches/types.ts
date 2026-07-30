import type {
	BatchRequestCounts,
	BatchRunItem,
	DatasetItem,
	ProviderConfig,
	TokenUsage,
} from "@agntz/contracts";
import type { BatchManifest, BatchProvider } from "@agntz/core/manifest";

export interface PreparedBatchRequest {
	item: DatasetItem;
	system: string;
	user: string | unknown[];
}

export interface ProviderBatchSubmission {
	id: string;
	status: string;
	createdAt?: string;
	expiresAt?: string;
}

export interface ProviderBatchState {
	id: string;
	status: string;
	terminal: boolean;
	outcome?: "completed" | "failed" | "expired" | "cancelled";
	counts?: Partial<BatchRequestCounts>;
	startedAt?: string;
	endedAt?: string;
	expiresAt?: string;
	error?: string;
	raw: unknown;
}

export interface ProviderBatchResult {
	itemId: string;
	status: BatchRunItem["status"];
	output?: unknown;
	rawOutput?: string;
	error?: string;
	usage?: TokenUsage;
	finishReason?: string;
	providerRequestId?: string;
}

export interface BatchProviderLimits {
	/** Native provider limit. Undefined means the provider documents no item cap. */
	maxRequests?: number;
	/** Native provider input-file/body limit. Undefined means it is not applicable. */
	maxInputBytes?: number;
}

export interface BatchProviderAdapter {
	readonly provider: BatchProvider;
	readonly limits: BatchProviderLimits;
	submit(options: {
		config: ProviderConfig;
		runId: string;
		manifest: BatchManifest;
		requests: PreparedBatchRequest[];
	}): Promise<ProviderBatchSubmission>;
	get(
		config: ProviderConfig,
		providerBatchId: string,
	): Promise<ProviderBatchState>;
	cancel(config: ProviderConfig, providerBatchId: string): Promise<void>;
	results(
		config: ProviderConfig,
		state: ProviderBatchState,
	): Promise<ProviderBatchResult[]>;
}

export type BatchProviderRegistry = Record<BatchProvider, BatchProviderAdapter>;
