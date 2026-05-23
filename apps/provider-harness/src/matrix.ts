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
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'multimodalImage', 'structuredOutput', 'cancellation'),
    notes: 'Llama 4 flagship via OpenRouter; natively multimodal.',
  },
  {
    provider: 'openrouter',
    model: 'mistralai/mistral-medium-3.5',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'parallelTools', 'streamingTools', 'toolChoice', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'Mistral family via OpenRouter; text-only.',
  },
  {
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'structuredOutput', 'reasoning', 'cancellation'),
    notes: 'DeepSeek family via OpenRouter.',
  },
  {
    provider: 'openrouter',
    model: 'qwen/qwen-3.7-max',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'structuredOutput', 'cancellation'),
    notes: 'Qwen family via OpenRouter.',
  },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-4-scout',
    capabilities: caps('text', 'multiTurn', 'systemPrompt', 'streaming', 'tools', 'multimodalImage', 'structuredOutput', 'cancellation'),
    notes: 'Fast/cheap Llama 4 sibling via OpenRouter.',
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
      'structuredOutput',
      'reasoning',
      'cancellation',
    ]),
    notes: 'Text-only — image support sits in Mistral Small 4 / Pixtral, not Medium.',
  },
  {
    provider: 'groq',
    model: 'llama-4-scout',
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
    model: 'command-a-plus',
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
  ...OPENROUTER_ROUTES,
];
