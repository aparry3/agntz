import type { TestDefinition } from '../types.js';
import { longInput } from './long-input.js';
import { multiTurnText } from './multi-turn.js';
import { singleTurnText } from './single-turn.js';
import { systemPrompt } from './system-prompt.js';

export const ALL_TESTS: readonly TestDefinition[] = [
  singleTurnText,
  multiTurnText,
  systemPrompt,
  longInput,
];
