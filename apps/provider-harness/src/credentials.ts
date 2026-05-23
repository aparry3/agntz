import type { Provider } from './types.js';

// Mirrors @agntz/core's ENV_MAP in model-provider.ts. Kept local so the
// harness can preflight credentials without constructing a provider.
const ENV_VAR: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
  cohere: 'COHERE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export function envVarFor(provider: Provider): string {
  return ENV_VAR[provider];
}

export function hasCredentials(provider: Provider): boolean {
  const value = process.env[ENV_VAR[provider]];
  return typeof value === 'string' && value.trim().length > 0;
}
