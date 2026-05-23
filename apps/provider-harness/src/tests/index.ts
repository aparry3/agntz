import type { TestDefinition } from '../types.js';
import { singleTurnText } from './single-turn.js';

export const ALL_TESTS: readonly TestDefinition[] = [
  singleTurnText,
];
