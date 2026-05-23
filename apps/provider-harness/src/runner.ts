import { classify, isMissingCredentials } from './bucket.js';
import { Semaphore } from './semaphore.js';
import { compareSnapshot } from './snapshot.js';
import type { ProviderModelEntry, TestDefinition, TestResult } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_PROVIDER_CONCURRENCY = 4;

export interface RunOptions {
  matrix: readonly ProviderModelEntry[];
  tests: readonly TestDefinition[];
  providerConcurrency?: number;
  defaultTimeoutMs?: number;
  updateSnapshots?: boolean;
}

export async function runMatrix(opts: RunOptions): Promise<TestResult[]> {
  const concurrency = opts.providerConcurrency ?? DEFAULT_PROVIDER_CONCURRENCY;
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const updateSnapshots = opts.updateSnapshots ?? false;

  const semaphores = new Map<string, Semaphore>();
  const semaphoreFor = (provider: string): Semaphore => {
    let s = semaphores.get(provider);
    if (!s) {
      s = new Semaphore(concurrency);
      semaphores.set(provider, s);
    }
    return s;
  };

  const tasks: Array<Promise<TestResult>> = [];
  for (const entry of opts.matrix) {
    for (const test of opts.tests) {
      tasks.push(runOne(entry, test, semaphoreFor(entry.provider), defaultTimeoutMs, updateSnapshots));
    }
  }
  return Promise.all(tasks);
}

async function runOne(
  model: ProviderModelEntry,
  test: TestDefinition,
  semaphore: Semaphore,
  defaultTimeoutMs: number,
  updateSnapshots: boolean,
): Promise<TestResult> {
  return semaphore.run(async () => {
    const timeoutMs = test.timeoutMs ?? defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const start = Date.now();

    const base = {
      test: test.id,
      provider: model.provider,
      model: model.model,
    } as const;

    try {
      const output = await test.run(model, { abortSignal: controller.signal });
      const durationMs = Date.now() - start;
      const capabilitySupported = model.capabilities.has(test.capability);

      if (output.ok) {
        if (output.snapshot !== undefined) {
          const snap = await compareSnapshot({
            testId: test.id,
            provider: model.provider,
            model: model.model,
            value: output.snapshot,
            update: updateSnapshots,
          });
          if (snap.kind === 'mismatch') {
            return {
              ...base,
              bucket: 'SDK_ERROR',
              durationMs,
              error: {
                name: 'SnapshotMismatch',
                message: `structural snapshot drift for ${test.id} (${snap.path})`,
              },
              snapshotDiff: snap.diff,
            };
          }
        }
        return {
          ...base,
          bucket: classify({ capabilitySupported, outcome: { kind: 'pass' } }),
          durationMs,
        };
      }
      return {
        ...base,
        bucket: classify({
          capabilitySupported,
          outcome: { kind: 'assertion-failed', reason: output.reason ?? 'unknown' },
        }),
        durationMs,
        error: { name: 'AssertionFailed', message: output.reason ?? 'test returned ok:false' },
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        return {
          ...base,
          bucket: 'TIMEOUT',
          durationMs,
        };
      }

      if (isMissingCredentials(error)) {
        return {
          ...base,
          bucket: 'SKIPPED',
          durationMs,
          skipReason: `missing credentials (${error.message})`,
        };
      }

      const capabilitySupported = model.capabilities.has(test.capability);
      return {
        ...base,
        bucket: classify({ capabilitySupported, outcome: { kind: 'thrown', error } }),
        durationMs,
        error: { name: error.name, message: error.message, stack: error.stack },
      };
    } finally {
      clearTimeout(timer);
    }
  });
}
