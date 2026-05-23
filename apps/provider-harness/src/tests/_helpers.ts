import { AISDKModelProvider } from '@agntz/core';
import type { ProviderModelEntry, TestOutput } from '../types.js';

export const provider = new AISDKModelProvider();

export function modelConfig(model: ProviderModelEntry): { provider: string; name: string } {
  return { provider: model.provider, name: model.model };
}

export function assertNonEmptyText(text: unknown): TestOutput {
  if (typeof text !== 'string' || text.trim().length === 0) {
    const preview = JSON.stringify(text)?.slice(0, 120) ?? String(text);
    return { ok: false, reason: `expected non-empty text, got: ${preview}` };
  }
  return { ok: true };
}
