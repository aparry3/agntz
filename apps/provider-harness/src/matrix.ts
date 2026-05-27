import type { Capability, ProviderModelEntry } from './types.js';

export const ALL_CAPABILITIES: readonly Capability[] = [
  'text',
  'multiTurn',
  'systemPrompt',
  'streaming',
  'tools',
  'parallelTools',
  'streamingTools',
  'toolChoice',
  'multimodalImage',
  'structuredOutput',
  'reasoning',
  'cancellation',
];

const caps = (...c: Capability[]): ReadonlySet<Capability> => new Set(c);

// OpenRouter subset — 8 family-representative routes (plan §08). Validates
// OpenRouter's pass-through across model families without testing every route.
// Capabilities are best-effort per underlying family; the first run with a real
// OPENROUTER_API_KEY is the verification.
const OPENROUTER_ROUTES: readonly ProviderModelEntry[] = [
  {
    provider: 'openrouter',
    model: 'anthropic/claude-opus-4-7',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Claude family via OpenRouter.',
  },
  {
    provider: 'openrouter',
    model: 'openai/gpt-5.5',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'OpenAI family via OpenRouter.',
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-3.5-flash',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Gemini family via OpenRouter.',
  },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-4-maverick',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'multimodalImage', 'structuredOutput', 'cancellation'),
    notes: 'Maverick: OpenRouter routes it to a no-tool-use endpoint, so tool caps are off for this route (harness run 2026-05-23).',
  },
  {
    provider: 'openrouter',
    model: 'mistralai/mistral-medium-3-5',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Mistral family via OpenRouter (slug uses hyphens: mistral-medium-3-5).',
  },
  {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-pro',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'DeepSeek family via OpenRouter; tool caps confirmed by harness run 2026-05-23.',
  },
  {
    provider: 'openrouter',
    model: 'qwen/qwen3.7-max',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'structuredOutput', 'cancellation'),
    notes: 'Qwen family via OpenRouter; tool caps confirmed by harness run 2026-05-23.',
  },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-4-scout',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'cancellation'),
    notes: 'Fast/cheap Llama 4 via OpenRouter; tool caps confirmed by harness run 2026-05-23.',
  },
];

// Prior-generation models — one immediately-previous model per provider, so the
// harness catches SDK regressions that only surface on older model surfaces
// (different finish-reason shapes, tool schemas, multimodal handling, etc.).
// IDs and caps are best-effort from the app's model catalog (supported-providers.ts);
// the first live run confirms availability and flips any wrong capability cell.
const PRIOR_GENERATION: readonly ProviderModelEntry[] = [
  {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Prior gen of claude-opus-4-7.',
  },
  {
    provider: 'openai',
    model: 'gpt-5.4',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Prior gen of gpt-5.5.',
  },
  {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Prior gen of gemini-3.5-flash. Live ID is gemini-3-flash-preview; plain gemini-3-flash 404s (confirmed via ListModels 2026-05-24).',
  },
  {
    provider: 'mistral',
    model: 'mistral-medium-3',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'multimodalImage', 'structuredOutput', 'cancellation'),
    notes: 'Prior gen of mistral-medium-3.5.',
  },
  {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'cancellation'),
    notes: 'Prior gen on Groq (Llama 3.3 70B). Text-only (no image) and no json_schema structured-output — both confirmed by harness run 2026-05-24.',
  },
  {
    provider: 'cohere',
    model: 'command-a-03-2025',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'structuredOutput', 'cancellation'),
    notes: 'Prior gen of command-a-plus-05-2026; predates the unified vision/reasoning surface.',
  },
];

// Cells are best-effort declarations pending verification by the harness itself.
// Capabilities that the planning doc marked as uncertain are included optimistically;
// the first run will surface anything that needs to flip via UNEXPECTED_UNSUPPORTED.

export const MATRIX: readonly ProviderModelEntry[] = [
  {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
  },
  {
    provider: 'openai',
    model: 'gpt-5.5',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
  },
  {
    provider: 'google',
    model: 'gemini-3.5-flash',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
    notes: 'Pro variant delayed to June 2026; Flash is the available 3.5 entry point.',
  },
  {
    provider: 'mistral',
    model: 'mistral-medium-3.5',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
    notes: 'multimodalImage confirmed by harness run 2026-05-23 (matrix was too conservative).',
  },
  {
    provider: 'groq',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'cancellation',
    ]),
    notes: 'Llama 4 is natively multimodal; no extended-thinking surface exposed.',
  },
  {
    provider: 'cohere',
    model: 'command-a-plus-05-2026',
    capabilities: new Set<Capability>([
      'text',
      'multiTurn',
      'systemPrompt',
      'streaming',
      'tools',
      'parallelTools',
      'streamingTools',
      'toolChoice',
      'multimodalImage',
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
    notes: 'Command A+ unifies Command A / Vision / Reasoning / Translate (May 2026).',
  },
  ...PRIOR_GENERATION,
  ...OPENROUTER_ROUTES,
];
