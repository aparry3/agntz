import type { TestDefinition } from '../types.js';
import { cancellation } from './cancellation.js';
import { invalidKey } from './invalid-key.js';
import { longInput } from './long-input.js';
import { multimodalBase64, multimodalUrl } from './multimodal.js';
import { multiTurnText } from './multi-turn.js';
import { parallelTools } from './parallel-tools.js';
import { reasoning } from './reasoning.js';
import { singleTurnText } from './single-turn.js';
import { streamingText } from './streaming-text.js';
import { streamingTools } from './streaming-tools.js';
import { structuredOutput } from './structured-output.js';
import { systemPrompt } from './system-prompt.js';
import { telemetryShape } from './telemetry.js';
import { toolChoiceAuto } from './tool-choice.js';
import { toolRoundtrip } from './tool-roundtrip.js';

export const ALL_TESTS: readonly TestDefinition[] = [
  singleTurnText,
  multiTurnText,
  systemPrompt,
  longInput,
  streamingText,
  streamingTools,
  toolRoundtrip,
  parallelTools,
  toolChoiceAuto,
  multimodalBase64,
  multimodalUrl,
  structuredOutput,
  reasoning,
  cancellation,
  telemetryShape,
  invalidKey,
];
