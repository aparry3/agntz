export type Provider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'groq'
  | 'cohere'
  | 'openrouter';

export type Capability =
  | 'text'
  | 'multiTurn'
  | 'systemPrompt'
  | 'streaming'
  | 'tools'
  | 'parallelTools'
  | 'streamingTools'
  | 'toolChoice'
  | 'multimodalImage'
  | 'structuredOutput'
  | 'reasoning'
  | 'cancellation';

export interface ProviderModelEntry {
  provider: Provider;
  model: string;
  capabilities: ReadonlySet<Capability>;
  notes?: string;
}

export type ResultBucket =
  | 'PASS'
  | 'EXPECTED_UNSUPPORTED'
  | 'UNEXPECTED_UNSUPPORTED'
  | 'SDK_ERROR'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT';

export interface TestRunContext {
  abortSignal?: AbortSignal;
}

export interface TestOutput {
  ok: boolean;
  reason?: string;
  snapshot?: unknown;
}

export interface TestDefinition {
  id: string;
  capability: Capability;
  timeoutMs?: number;
  run: (model: ProviderModelEntry, ctx: TestRunContext) => Promise<TestOutput>;
}

export interface TestResult {
  test: string;
  provider: Provider;
  model: string;
  bucket: ResultBucket;
  durationMs: number;
  error?: { name: string; message: string; stack?: string };
  snapshotDiff?: string;
}
