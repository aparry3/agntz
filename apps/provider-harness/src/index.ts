import { ALL_CAPABILITIES, MATRIX } from './matrix.js';
import { writeReport } from './report.js';
import { runMatrix } from './runner.js';
import { ALL_TESTS } from './tests/index.js';
import type { Capability, ProviderModelEntry, ResultBucket, TestResult } from './types.js';

const SHORT_LABEL: Record<Capability, string> = {
  text: 'text',
  multiTurn: 'mult',
  systemPrompt: 'sys',
  streaming: 'strm',
  tools: 'tool',
  parallelTools: 'ptl',
  streamingTools: 'stl',
  toolChoice: 'tch',
  multimodalImage: 'img',
  structuredOutput: 'json',
  reasoning: 'rsn',
  cancellation: 'cncl',
};

const COL = 5;

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function printMatrix(entries: readonly ProviderModelEntry[]): void {
  const providerW = Math.max('provider'.length, ...entries.map((e) => e.provider.length)) + 2;
  const modelW = Math.max('model'.length, ...entries.map((e) => e.model.length)) + 2;

  const header =
    pad('provider', providerW) +
    pad('model', modelW) +
    ALL_CAPABILITIES.map((c) => pad(SHORT_LABEL[c], COL)).join('');

  const rule =
    '─'.repeat(providerW - 2) + '  ' +
    '─'.repeat(modelW - 2) + '  ' +
    ALL_CAPABILITIES.map(() => '─'.repeat(COL - 1) + ' ').join('');

  console.log('  ' + header);
  console.log('  ' + rule);

  for (const entry of entries) {
    const row =
      pad(entry.provider, providerW) +
      pad(entry.model, modelW) +
      ALL_CAPABILITIES.map((c) =>
        pad(entry.capabilities.has(c) ? '✓' : '·', COL),
      ).join('');
    console.log('  ' + row);
  }
}

const BUCKET_COLOR: Record<ResultBucket, string> = {
  PASS: '\x1b[32m',
  EXPECTED_UNSUPPORTED: '\x1b[32m',
  UNEXPECTED_UNSUPPORTED: '\x1b[33m',
  SDK_ERROR: '\x1b[31m',
  PROVIDER_ERROR: '\x1b[34m',
  TIMEOUT: '\x1b[35m',
  SKIPPED: '\x1b[90m',
};
const RESET = '\x1b[0m';

function bucketCell(b: ResultBucket): string {
  return `${BUCKET_COLOR[b]}${pad(b, 24)}${RESET}`;
}

function printResults(results: readonly TestResult[]): void {
  const slugW = Math.max(...results.map((r) => `${r.provider}/${r.model}`.length)) + 2;
  const testW = Math.max(...results.map((r) => r.test.length)) + 2;

  // Stable ordering: by matrix order × test order (Promise.all preserves this).
  for (const r of results) {
    const slug = `${r.provider}/${r.model}`;
    const detail =
      r.bucket === 'SKIPPED'
        ? `  ${r.skipReason ?? ''}`
        : r.bucket === 'PASS' || r.bucket === 'EXPECTED_UNSUPPORTED'
          ? `  ${r.durationMs}ms`
          : `  ${r.durationMs}ms  ${r.error?.message ?? ''}`;
    console.log(
      '  ' +
        pad(slug, slugW) +
        pad(r.test, testW) +
        bucketCell(r.bucket) +
        detail,
    );
  }
}

function printSummary(results: readonly TestResult[]): void {
  const counts: Record<ResultBucket, number> = {
    PASS: 0,
    EXPECTED_UNSUPPORTED: 0,
    UNEXPECTED_UNSUPPORTED: 0,
    SDK_ERROR: 0,
    PROVIDER_ERROR: 0,
    TIMEOUT: 0,
    SKIPPED: 0,
  };
  for (const r of results) counts[r.bucket]++;

  const parts: string[] = [`${results.length} results`];
  for (const [bucket, n] of Object.entries(counts) as [ResultBucket, number][]) {
    if (n > 0) parts.push(`${n} ${bucket}`);
  }
  console.log('  ' + parts.join(' · '));
}

async function main(): Promise<void> {
  console.log('');
  console.log('  agntz · provider harness · v0.1 — Phase 2 (runner + single-turn)');
  console.log('');
  console.log(
    `  Matrix: ${MATRIX.length} models, ${ALL_CAPABILITIES.length} capability dimensions`,
  );
  console.log(`  Tests: ${ALL_TESTS.length}`);
  console.log('');
  printMatrix(MATRIX);
  console.log('');
  console.log(`  Running ${ALL_TESTS.length} test(s) × ${MATRIX.length} models in parallel...`);
  console.log('');

  // Silence core's per-call diagnostic logging during the run — it dumps full
  // stack traces for every failure (including the SKIPPED cases) and drowns
  // the harness's structured output. The TestResult.error field captures the
  // essentials we actually need.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const startedAt = new Date();
  let results;
  try {
    results = await runMatrix({ matrix: MATRIX, tests: ALL_TESTS });
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  const finishedAt = new Date();

  printResults(results);
  console.log('');
  console.log('  Summary');
  console.log('  ───────');
  printSummary(results);
  console.log('');

  const written = await writeReport({ startedAt, finishedAt, matrix: MATRIX, results });
  console.log(`  Wrote ${written.markdownPath}`);
  console.log(`  Wrote ${written.jsonPath}`);
  console.log(`  Symlinked ${written.latestMarkdownPath} → latest`);
  console.log('');

  const hasFailure = results.some(
    (r) => r.bucket === 'SDK_ERROR' || r.bucket === 'UNEXPECTED_UNSUPPORTED',
  );
  process.exit(hasFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('');
  console.error('  Harness crashed before completing:');
  console.error(err);
  process.exit(2);
});
