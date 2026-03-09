import type {
  AgentDefinition,
  EvalConfig,
  EvalTestCase,
  EvalAssertion,
  EvalResult,
  InvokeOptions,
  InvokeResult,
  ModelProvider,
  GenerateTextOptions,
} from "./types.js";

/**
 * Eval assertion result for a single assertion.
 */
export interface AssertionResult {
  type: string;
  passed: boolean;
  score?: number;
  reason?: string;
}

/**
 * Options for running evals.
 */
export interface EvalRunOptions {
  /** Override test cases (instead of using agent.eval.testCases) */
  testCases?: EvalTestCase[];
  /** Invoke function (bound to the runner) */
  invoke: (agentId: string, input: string, options?: InvokeOptions) => Promise<InvokeResult>;
  /** Model provider for LLM-as-judge assertions */
  modelProvider?: ModelProvider;
  /** Abort signal */
  signal?: AbortSignal;
  /** Callback for progress updates */
  onProgress?: (completed: number, total: number, testCase: string) => void;
}

/**
 * Run the eval suite for an agent definition.
 */
export async function runEval(
  agent: AgentDefinition,
  options: EvalRunOptions
): Promise<EvalResult> {
  const startTime = Date.now();
  const evalConfig = agent.eval ?? {};
  const testCases = options.testCases ?? evalConfig.testCases ?? [];

  if (testCases.length === 0) {
    return {
      agentId: agent.id,
      timestamp: new Date().toISOString(),
      duration: 0,
      testCases: [],
      summary: { total: 0, passed: 0, failed: 0, score: 1 },
    };
  }

  const results: EvalResult["testCases"] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];

    if (options.signal?.aborted) {
      break;
    }

    const caseName = tc.name ?? `test_${i + 1}`;
    options.onProgress?.(i, testCases.length, caseName);

    try {
      // Build invoke options
      const invokeOpts: InvokeOptions = {};
      if (tc.context) {
        invokeOpts.extraContext = tc.context;
      }

      // Invoke the agent
      const result = await options.invoke(agent.id, tc.input, invokeOpts);
      const output = result.output;

      // Run assertions
      const assertions = tc.assertions ?? [];
      const assertionResults: AssertionResult[] = [];

      // If expectedOutput is set and no assertions defined, add a semantic-similar assertion
      if (tc.expectedOutput && assertions.length === 0) {
        assertionResults.push(
          await runAssertion(
            { type: "contains", value: tc.expectedOutput },
            output,
            tc.input,
            evalConfig,
            options
          )
        );
      } else {
        for (const assertion of assertions) {
          assertionResults.push(
            await runAssertion(assertion, output, tc.input, evalConfig, options)
          );
        }
      }

      // Calculate score (weighted average)
      const totalWeight = assertionResults.reduce((sum, _, idx) => {
        return sum + (assertions[idx]?.weight ?? 1);
      }, 0) || 1;

      const weightedScore = assertionResults.reduce((sum, r, idx) => {
        const weight = assertions[idx]?.weight ?? 1;
        const score = r.score ?? (r.passed ? 1 : 0);
        return sum + score * weight;
      }, 0);

      const score = weightedScore / totalWeight;
      const threshold = evalConfig.passThreshold ?? 0.7;
      const passed = score >= threshold;

      results.push({
        name: caseName,
        input: tc.input,
        output,
        assertions: assertionResults,
        passed,
        score,
      });
    } catch (error) {
      results.push({
        name: caseName,
        input: tc.input,
        output: "",
        assertions: [
          {
            type: "error",
            passed: false,
            score: 0,
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
        passed: false,
        score: 0,
      });
    }
  }

  options.onProgress?.(testCases.length, testCases.length, "done");

  const duration = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 1;

  return {
    agentId: agent.id,
    timestamp: new Date().toISOString(),
    duration,
    testCases: results,
    summary: {
      total: results.length,
      passed,
      failed,
      score: avgScore,
    },
  };
}

/**
 * Run a single assertion against the agent's output.
 */
async function runAssertion(
  assertion: EvalAssertion,
  output: string,
  input: string,
  evalConfig: EvalConfig,
  options: EvalRunOptions
): Promise<AssertionResult> {
  switch (assertion.type) {
    case "contains":
      return assertContains(output, assertion.value as string);

    case "not-contains":
      return assertNotContains(output, assertion.value as string);

    case "regex":
      return assertRegex(output, assertion.value as string);

    case "json-schema":
      return assertJsonSchema(output, assertion.value as object);

    case "llm-rubric":
      return assertLLMRubric(
        output,
        input,
        assertion.value as string,
        evalConfig,
        options
      );

    case "semantic-similar":
      return assertSemanticSimilar(
        output,
        assertion.value as string,
        evalConfig,
        options
      );

    case "custom":
      return {
        type: "custom",
        passed: false,
        score: 0,
        reason: "Custom assertions must be implemented by the user",
      };

    default:
      return {
        type: assertion.type,
        passed: false,
        score: 0,
        reason: `Unknown assertion type: ${assertion.type}`,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Assertion implementations
// ═══════════════════════════════════════════════════════════════════

function assertContains(output: string, value: string): AssertionResult {
  const normalizedOutput = output.toLowerCase();
  const normalizedValue = value.toLowerCase();
  const passed = normalizedOutput.includes(normalizedValue);

  return {
    type: "contains",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Output contains "${value}"`
      : `Output does not contain "${value}"`,
  };
}

function assertNotContains(output: string, value: string): AssertionResult {
  const normalizedOutput = output.toLowerCase();
  const normalizedValue = value.toLowerCase();
  const passed = !normalizedOutput.includes(normalizedValue);

  return {
    type: "not-contains",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Output does not contain "${value}"`
      : `Output unexpectedly contains "${value}"`,
  };
}

function assertRegex(output: string, pattern: string): AssertionResult {
  try {
    const regex = new RegExp(pattern, "i");
    const passed = regex.test(output);

    return {
      type: "regex",
      passed,
      score: passed ? 1 : 0,
      reason: passed
        ? `Output matches pattern /${pattern}/`
        : `Output does not match pattern /${pattern}/`,
    };
  } catch {
    return {
      type: "regex",
      passed: false,
      score: 0,
      reason: `Invalid regex pattern: ${pattern}`,
    };
  }
}

function assertJsonSchema(
  output: string,
  schema: object
): AssertionResult {
  try {
    const parsed = JSON.parse(output);

    // Basic JSON Schema validation (type, required, properties)
    const errors = validateJsonSchema(parsed, schema as JsonSchema);
    const passed = errors.length === 0;

    return {
      type: "json-schema",
      passed,
      score: passed ? 1 : 0,
      reason: passed
        ? "Output matches JSON schema"
        : `Schema validation errors: ${errors.join("; ")}`,
    };
  } catch {
    return {
      type: "json-schema",
      passed: false,
      score: 0,
      reason: "Output is not valid JSON",
    };
  }
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

function validateJsonSchema(value: unknown, schema: JsonSchema): string[] {
  const errors: string[] = [];

  if (schema.type) {
    const actualType = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value;

    if (actualType !== schema.type) {
      errors.push(`Expected type "${schema.type}", got "${actualType}"`);
      return errors;
    }
  }

  if (schema.type === "object" && typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push(`Missing required property "${key}"`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateJsonSchema(obj[key], propSchema));
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateJsonSchema(value[i], schema.items));
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`Value must be one of: ${schema.enum.join(", ")}`);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`Value ${value} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`Value ${value} is greater than maximum ${schema.maximum}`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(
        `String length ${value.length} is less than minLength ${schema.minLength}`
      );
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(
        `String length ${value.length} is greater than maxLength ${schema.maxLength}`
      );
    }
  }

  return errors;
}

/**
 * LLM-as-judge rubric assertion.
 * Uses a model to evaluate the output against a rubric.
 */
async function assertLLMRubric(
  output: string,
  input: string,
  rubric: string,
  evalConfig: EvalConfig,
  options: EvalRunOptions
): Promise<AssertionResult> {
  if (!options.modelProvider) {
    return {
      type: "llm-rubric",
      passed: false,
      score: 0,
      reason: "LLM rubric assertions require a modelProvider",
    };
  }

  const judgePrompt = `You are an evaluator. Score the following AI agent output on a scale of 0.0 to 1.0 based on the rubric.

## Rubric
${rubric}

## User Input
${input}

## Agent Output
${output}

## Instructions
Respond with ONLY a JSON object:
{
  "score": <number between 0.0 and 1.0>,
  "reason": "<brief explanation>"
}`;

  try {
    const result = await options.modelProvider.generateText({
      model: {
        provider: "openai",
        name: evalConfig.evalModel ?? "gpt-4o-mini",
      },
      messages: [{ role: "user", content: judgePrompt }],
    });

    // Parse the judge response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        type: "llm-rubric",
        passed: false,
        score: 0,
        reason: `Failed to parse judge response: ${result.text}`,
      };
    }

    const judge = JSON.parse(jsonMatch[0]) as {
      score: number;
      reason: string;
    };
    const threshold = evalConfig.passThreshold ?? 0.7;

    return {
      type: "llm-rubric",
      passed: judge.score >= threshold,
      score: judge.score,
      reason: judge.reason,
    };
  } catch (error) {
    return {
      type: "llm-rubric",
      passed: false,
      score: 0,
      reason: `Judge error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Semantic similarity assertion.
 * Uses LLM to judge if output is semantically similar to expected.
 */
async function assertSemanticSimilar(
  output: string,
  expected: string,
  evalConfig: EvalConfig,
  options: EvalRunOptions
): Promise<AssertionResult> {
  if (!options.modelProvider) {
    // Fallback to fuzzy string matching if no model provider
    const similarity = jaccardSimilarity(output, expected);
    return {
      type: "semantic-similar",
      passed: similarity >= 0.3,
      score: similarity,
      reason: `Jaccard similarity: ${(similarity * 100).toFixed(1)}% (no model provider for semantic check)`,
    };
  }

  const prompt = `Compare these two texts for semantic similarity. Are they saying essentially the same thing?

## Expected
${expected}

## Actual
${output}

Respond with ONLY a JSON object:
{
  "score": <number between 0.0 and 1.0, where 1.0 means identical meaning>,
  "reason": "<brief explanation>"
}`;

  try {
    const result = await options.modelProvider.generateText({
      model: {
        provider: "openai",
        name: evalConfig.evalModel ?? "gpt-4o-mini",
      },
      messages: [{ role: "user", content: prompt }],
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        type: "semantic-similar",
        passed: false,
        score: 0,
        reason: `Failed to parse similarity response: ${result.text}`,
      };
    }

    const judge = JSON.parse(jsonMatch[0]) as {
      score: number;
      reason: string;
    };
    const threshold = evalConfig.passThreshold ?? 0.7;

    return {
      type: "semantic-similar",
      passed: judge.score >= threshold,
      score: judge.score,
      reason: judge.reason,
    };
  } catch (error) {
    return {
      type: "semantic-similar",
      passed: false,
      score: 0,
      reason: `Similarity check error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Simple Jaccard similarity between two texts (word-level).
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}
