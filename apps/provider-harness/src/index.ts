import { ALL_CAPABILITIES, MATRIX } from './matrix.js';
import type { Capability, ProviderModelEntry } from './types.js';

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

function printNotes(entries: readonly ProviderModelEntry[]): void {
  const withNotes = entries.filter((e) => e.notes);
  if (withNotes.length === 0) return;
  console.log('');
  console.log('  Notes');
  console.log('  ─────');
  for (const entry of withNotes) {
    console.log(`  ${entry.provider}/${entry.model} — ${entry.notes}`);
  }
}

console.log('');
console.log('  agntz · provider harness · v0.1 — Phase 1 (skeleton)');
console.log('');
console.log(
  `  Loaded capability matrix — ${MATRIX.length} models, ${ALL_CAPABILITIES.length} capability dimensions`,
);
console.log('');
printMatrix(MATRIX);
printNotes(MATRIX);
console.log('');
console.log('  Phase 1 stops here. Phase 2 wires up the runner.');
console.log('');
