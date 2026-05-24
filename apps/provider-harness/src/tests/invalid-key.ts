import { AISDKModelProvider } from '@agntz/core';
import { isMissingCredentials } from '../bucket.js';
import type { TestDefinition } from '../types.js';
import { modelConfig } from './_helpers.js';

// A provider wired to a deliberately-invalid key via a stub ProviderStore
// (checked before env), so the negative-path test neither depends on nor
// mutates the real credentials.
const badKeyProvider = new AISDKModelProvider({
  providerStore: {
    async getProvider(id: string) {
      return { id, apiKey: 'invalid-agntz-harness-negative-test-key' };
    },
    async listProviders() {
      return [];
    },
    async putProvider() {},
    async deleteProvider() {},
  },
});

export const invalidKey: TestDefinition = {
  id: 'invalid-api-key',
  capability: 'text',
  async run(model, ctx) {
    try {
      await badKeyProvider.generateText({
        model: modelConfig(model),
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 16,
        signal: ctx.abortSignal,
      });
      return { ok: false, reason: 'expected an auth error with an invalid key, but the call succeeded' };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      // Success = a typed, recognizable auth error, not a generic crash.
      if (
        isMissingCredentials(e) ||
        /\b401\b|\b403\b|unauthorized|forbidden|invalid|api[\s_-]?key|authentication/i.test(e.message)
      ) {
        return { ok: true };
      }
      return { ok: false, reason: `expected a typed auth error, got ${e.name}: ${e.message.slice(0, 120)}` };
    }
  },
};
