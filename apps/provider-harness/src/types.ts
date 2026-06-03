export type Provider =
	| "anthropic"
	| "openai"
	| "google"
	| "mistral"
	| "groq"
	| "cohere"
	| "openrouter";

export type HarnessSdk = "ts" | "python";
export type HarnessSdkSelection = HarnessSdk | "both";

export type Capability =
	| "text"
	| "multiTurn"
	| "systemPrompt"
	| "streaming"
	| "tools"
	| "parallelTools"
	| "streamingTools"
	| "toolChoice"
	| "multimodalImage"
	| "structuredOutput"
	| "reasoning"
	| "cancellation";

export interface ProviderModelEntry {
	provider: Provider;
	model: string;
	capabilities: ReadonlySet<Capability>;
	notes?: string;
}

export type ResultBucket =
	| "PASS"
	| "EXPECTED_UNSUPPORTED"
	| "UNEXPECTED_UNSUPPORTED"
	| "SDK_ERROR"
	| "PROVIDER_ERROR"
	| "RATE_LIMITED"
	| "TIMEOUT"
	| "SKIPPED";

export interface TestRunContext {
	sdk: HarnessSdk;
	adapter: ProviderAdapter;
	abortSignal?: AbortSignal;
}

export interface TestOutput {
	ok: boolean;
	reason?: string;
	snapshot?: unknown;
	/** If set, the test opted to skip itself (e.g. missing optional config). */
	skip?: string;
}

export interface TestDefinition {
	id: string;
	capability: Capability;
	timeoutMs?: number;
	run: (model: ProviderModelEntry, ctx: TestRunContext) => Promise<TestOutput>;
}

export interface TestResult {
	sdk: HarnessSdk;
	test: string;
	provider: Provider;
	model: string;
	bucket: ResultBucket;
	durationMs: number;
	error?: { name: string; message: string; stack?: string };
	snapshotDiff?: string;
	skipReason?: string;
}

export interface HarnessModelConfig {
	provider: Provider;
	name: string;
}

export interface HarnessMessage {
	role: string;
	content: unknown;
	tool_calls?: Array<Record<string, unknown>>;
	tool_call_id?: string;
}

export interface HarnessTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface HarnessGenerateTextOptions {
	model: HarnessModelConfig;
	messages: HarnessMessage[];
	tools?: readonly HarnessTool[];
	outputSchema?: {
		name: string;
		schema: Record<string, unknown>;
	};
	maxTokens?: number;
	signal?: AbortSignal;
	invalidApiKey?: boolean;
}

export interface HarnessToolCall {
	id: string;
	name: string;
	args: unknown;
	providerMetadata?: unknown;
}

export interface HarnessGenerateTextResult {
	text: string;
	toolCalls?: HarnessToolCall[];
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		costUsd?: number | null;
	};
	finishReason?: string;
	responseMessages?: HarnessMessage[];
	sessionMessages?: HarnessMessage[];
}

export interface HarnessStreamTextResult {
	textStream: AsyncIterable<string>;
	toolCalls: Promise<HarnessToolCall[]>;
	usage: Promise<HarnessGenerateTextResult["usage"]>;
	finishReason: Promise<string | undefined>;
	responseMessages?: Promise<HarnessMessage[] | undefined>;
}

export interface ProviderAdapter {
	sdk: HarnessSdk;
	generateText(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessGenerateTextResult>;
	streamText?(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessStreamTextResult>;
}
