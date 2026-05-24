import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = resolve(HERE, '..', '__snapshots__');

export type SnapshotResult =
  | { kind: 'match'; path: string }
  | { kind: 'created'; path: string }
  | { kind: 'updated'; path: string }
  | { kind: 'mismatch'; path: string; diff: string };

// Keys whose string values are enum-like and should survive normalization.
const PRESERVE_VALUE_FOR_KEYS = new Set([
  'role',
  'type',
  'name',
  'toolName',
  'finishReason',
  'finish_reason',
  'stop_reason',
]);

// Keys whose string values are non-deterministic identifiers.
const ID_LIKE_KEYS = new Set([
  'id',
  'tool_call_id',
  'toolCallId',
  'tool_use_id',
  'toolUseId',
]);

// Keys whose string values are stringified JSON (model-emitted arg blobs).
const STRINGIFIED_JSON_KEYS = new Set(['arguments']);

export function structuralSnapshot(value: unknown): unknown {
  return normalize(value);
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : '<non-finite>';
  if (typeof value === 'string') return '<string>';
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PRESERVE_VALUE_FOR_KEYS.has(k) && typeof v === 'string') {
        out[k] = v;
      } else if (ID_LIKE_KEYS.has(k) && typeof v === 'string') {
        out[k] = '<id>';
      } else if (STRINGIFIED_JSON_KEYS.has(k) && typeof v === 'string') {
        out[k] = '<json-string>';
      } else {
        out[k] = normalize(v);
      }
    }
    return out;
  }
  return value;
}

export async function compareSnapshot(args: {
  testId: string;
  provider: string;
  model: string;
  value: unknown;
  update?: boolean;
}): Promise<SnapshotResult> {
  const path = snapshotPath(args.testId, args.provider, args.model);
  const actual = serializeForSnapshot(args.value);

  if (args.update) {
    const existed = await fileExists(path);
    await writeSnapshotFile(path, actual);
    return { kind: existed ? 'updated' : 'created', path };
  }

  let expected: string;
  try {
    expected = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await writeSnapshotFile(path, actual);
      return { kind: 'created', path };
    }
    throw err;
  }

  if (expected === actual) {
    return { kind: 'match', path };
  }
  return {
    kind: 'mismatch',
    path,
    diff: simpleLineDiff(expected, actual),
  };
}

function snapshotPath(testId: string, provider: string, model: string): string {
  const safeModel = model.replace(/[^\w.-]/g, '-');
  return resolve(SNAPSHOTS_DIR, testId, `${provider}-${safeModel}.json`);
}

async function writeSnapshotFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function serializeForSnapshot(value: unknown): string {
  return JSON.stringify(structuralSnapshot(value), null, 2) + '\n';
}

function simpleLineDiff(expected: string, actual: string): string {
  const expLines = expected.split('\n');
  const actLines = actual.split('\n');
  const max = Math.max(expLines.length, actLines.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const e = expLines[i];
    const a = actLines[i];
    if (e === a) {
      out.push(`  ${e ?? ''}`);
    } else {
      if (e !== undefined) out.push(`- ${e}`);
      if (a !== undefined) out.push(`+ ${a}`);
    }
  }
  return out.join('\n');
}
