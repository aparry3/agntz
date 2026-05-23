import type { ResultBucket } from './types.js';

export type Outcome =
  | { kind: 'pass' }
  | { kind: 'assertion-failed'; reason: string }
  | { kind: 'thrown'; error: Error }
  | { kind: 'timeout' };

export function classify(input: {
  capabilitySupported: boolean;
  outcome: Outcome;
}): ResultBucket {
  const { capabilitySupported, outcome } = input;

  if (outcome.kind === 'timeout') return 'TIMEOUT';

  if (outcome.kind === 'pass') {
    return capabilitySupported ? 'PASS' : 'UNEXPECTED_UNSUPPORTED';
  }

  if (outcome.kind === 'assertion-failed') {
    // The call returned but our structural check on the result failed.
    // Treat as SDK_ERROR — the response shape didn't match what we expect.
    return 'SDK_ERROR';
  }

  const msg = outcome.error.message ?? '';

  if (looksLikeUnsupported(msg)) {
    return capabilitySupported ? 'UNEXPECTED_UNSUPPORTED' : 'EXPECTED_UNSUPPORTED';
  }
  if (looksLikeProviderError(msg)) {
    return 'PROVIDER_ERROR';
  }
  return 'SDK_ERROR';
}

export function isMissingCredentials(err: Error): boolean {
  const msg = (err.message ?? '').toLowerCase();
  // Each provider phrases missing/invalid auth differently. Treat both
  // "no key" and "key provided but rejected" as SKIPPED for harness purposes —
  // either way we can't actually test this model.
  if (/\bunauthorized\b/.test(msg)) return true;
  if (/x-api-key.*required|api[\s_-]?key.*required/.test(msg)) return true;
  if (/invalid[\s_-]api[\s_-]?key/.test(msg)) return true;
  if (/no api key|missing api key/.test(msg)) return true;
  if (/unregistered caller/.test(msg)) return true;
  if (/api[\s_-]?key|api[\s_-]?token/.test(msg) && /required|missing|not\s+(?:set|configured|provided|loaded|found)|undefined|no\b/.test(msg)) return true;
  if (/authentication.*(?:fail|required|missing|invalid)/.test(msg)) return true;
  if (/credential.*(?:missing|invalid|not.*set|required)/.test(msg)) return true;
  return false;
}

function looksLikeUnsupported(msg: string): boolean {
  return /unsupported|not\s+support|does\s+not\s+support|not\s+available|invalid_request_error.*unsupported|capability.*not/i.test(msg);
}

function looksLikeProviderError(msg: string): boolean {
  return /\b5\d{2}\b|service\s+unavailable|internal\s+server\s+error|server\s+error|bad\s+gateway|gateway\s+timeout/i.test(msg);
}
