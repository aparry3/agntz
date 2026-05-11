import type {
  EvalSuite,
  EvalSuiteAssertion,
  EvalSuiteAssertionResult,
  EvalSuiteCase,
  EvalSuiteCaseResult,
  EvalSuiteRun,
  ModelProvider,
  ModelConfig,
  ToolCallRecord,
} from "./types.js";
import { generateId } from "./utils/id.js";

export interface EvalSuiteExecuteResult {
  output: unknown;
  toolCalls?: ToolCallRecord[];
}

export interface EvalSuiteRunOptions {
  execute: (testCase: EvalSuiteCase) => Promise<unknown | EvalSuiteExecuteResult>;
  modelProvider?: ModelProvider;
  defaultJudgeModel?: ModelConfig;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, testCase: string) => void;
  now?: () => Date;
  runId?: string;
  agentVersionCreatedAt?: string;
}

export async function runEvalSuite(
  suite: EvalSuite,
  options: EvalSuiteRunOptions,
): Promise<EvalSuiteRun> {
  const started = options.now?.() ?? new Date();
  const enabledCases = suite.cases.filter((testCase) => testCase.enabled !== false);
  const caseResults: EvalSuiteCaseResult[] = [];

  for (let i = 0; i < enabledCases.length; i++) {
    if (options.signal?.aborted) break;
    const testCase = enabledCases[i];
    options.onProgress?.(i, enabledCases.length, testCase.name);
    caseResults.push(await runCase(suite, testCase, options));
  }

  options.onProgress?.(enabledCases.length, enabledCases.length, "done");

  const summary = summarize(caseResults);
  const ended = options.now?.() ?? new Date();
  return {
    id: options.runId ?? generateId("evalrun"),
    suiteId: suite.id,
    agentId: suite.agentId,
    agentVersionCreatedAt: options.agentVersionCreatedAt,
    status: "completed",
    summary,
    caseResults,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
  };
}

async function runCase(
  suite: EvalSuite,
  testCase: EvalSuiteCase,
  options: EvalSuiteRunOptions,
): Promise<EvalSuiteCaseResult> {
  const start = Date.now();
  try {
    const rawResult = await options.execute(testCase);
    const execution = normalizeExecuteResult(rawResult);
    const duration = Date.now() - start;
    const assertions = buildAssertions(suite, testCase);
    const assertionResults: EvalSuiteAssertionResult[] = [];

    for (const assertion of assertions) {
      assertionResults.push(
        await runAssertion(assertion, {
          suite,
          testCase,
          output: execution.output,
          duration,
          toolCalls: execution.toolCalls ?? [],
          modelProvider: options.modelProvider,
          defaultJudgeModel: options.defaultJudgeModel,
          signal: options.signal,
        }),
      );
    }

    const score = weightedScore(assertionResults, assertions);
    return {
      id: testCase.id,
      name: testCase.name,
      input: testCase.input,
      output: execution.output,
      assertions: assertionResults,
      passed: score >= suite.passThreshold,
      score,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - start;
    return {
      id: testCase.id,
      name: testCase.name,
      input: testCase.input,
      output: null,
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
      duration,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeExecuteResult(raw: unknown | EvalSuiteExecuteResult): EvalSuiteExecuteResult {
  if (
    raw &&
    typeof raw === "object" &&
    "output" in raw &&
    !Array.isArray(raw)
  ) {
    return raw as EvalSuiteExecuteResult;
  }
  return { output: raw };
}

function buildAssertions(suite: EvalSuite, testCase: EvalSuiteCase): EvalSuiteAssertion[] {
  if (testCase.assertions.length > 0) return testCase.assertions;
  if (testCase.expectedOutput !== undefined) {
    return [{ type: "semantic-similar", value: testCase.expectedOutput }];
  }
  if (suite.rubric) {
    return [{ type: "llm-rubric", value: suite.rubric }];
  }
  return [];
}

interface AssertionContext {
  suite: EvalSuite;
  testCase: EvalSuiteCase;
  output: unknown;
  duration: number;
  toolCalls: ToolCallRecord[];
  modelProvider?: ModelProvider;
  defaultJudgeModel?: ModelConfig;
  signal?: AbortSignal;
}

async function runAssertion(
  assertion: EvalSuiteAssertion,
  ctx: AssertionContext,
): Promise<EvalSuiteAssertionResult> {
  switch (assertion.type) {
    case "contains":
      return assertContains(ctx.output, assertion.value);
    case "not-contains":
      return assertNotContains(ctx.output, assertion.value);
    case "regex":
      return assertRegex(ctx.output, assertion.value);
    case "json-schema":
      return assertJsonSchema(ctx.output, assertion.value);
    case "equals":
      return assertEquals(ctx.output, assertion.value);
    case "field-exists":
      return assertFieldExists(ctx.output, assertion.path ?? String(assertion.value ?? ""));
    case "field-equals":
      return assertFieldEquals(ctx.output, assertion.path, assertion.value);
    case "numeric-range":
      return assertNumericRange(ctx.output, assertion.path, assertion.value);
    case "tool-called":
      return assertToolCalled(ctx.toolCalls, assertion.value);
    case "max-latency":
      return assertMaxLatency(ctx.duration, assertion.value);
    case "llm-rubric":
      return assertLLMRubric(assertion, ctx);
    case "semantic-similar":
      return assertSemanticSimilar(assertion, ctx);
    default:
      return {
        type: assertion.type,
        passed: false,
        score: 0,
        reason: `Unknown assertion type: ${assertion.type}`,
      };
  }
}

function assertContains(output: unknown, value: unknown): EvalSuiteAssertionResult {
  const needle = String(value ?? "").toLowerCase();
  const passed = stringify(output).toLowerCase().includes(needle);
  return {
    type: "contains",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? `Output contains "${needle}"` : `Output does not contain "${needle}"`,
  };
}

function assertNotContains(output: unknown, value: unknown): EvalSuiteAssertionResult {
  const needle = String(value ?? "").toLowerCase();
  const passed = !stringify(output).toLowerCase().includes(needle);
  return {
    type: "not-contains",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? `Output does not contain "${needle}"` : `Output contains "${needle}"`,
  };
}

function assertRegex(output: unknown, value: unknown): EvalSuiteAssertionResult {
  try {
    const pattern = new RegExp(String(value ?? ""));
    const passed = pattern.test(stringify(output));
    return {
      type: "regex",
      passed,
      score: passed ? 1 : 0,
      reason: passed ? "Output matches regex" : "Output does not match regex",
    };
  } catch (error) {
    return {
      type: "regex",
      passed: false,
      score: 0,
      reason: `Invalid regex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function assertJsonSchema(output: unknown, value: unknown): EvalSuiteAssertionResult {
  const errors = validateJsonSchema(output, value);
  const passed = errors.length === 0;
  return {
    type: "json-schema",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? "Output matches JSON schema" : errors.join("; "),
  };
}

function assertEquals(output: unknown, value: unknown): EvalSuiteAssertionResult {
  const passed = stableStringify(output) === stableStringify(value);
  return {
    type: "equals",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? "Output equals expected value" : "Output does not equal expected value",
  };
}

function assertFieldExists(output: unknown, path: string): EvalSuiteAssertionResult {
  const found = getPath(output, path) !== undefined;
  return {
    type: "field-exists",
    passed: found,
    score: found ? 1 : 0,
    reason: found ? `Field "${path}" exists` : `Field "${path}" is missing`,
  };
}

function assertFieldEquals(output: unknown, path: string | undefined, value: unknown): EvalSuiteAssertionResult {
  if (!path) {
    return { type: "field-equals", passed: false, score: 0, reason: "Missing field path" };
  }
  const actual = getPath(output, path);
  const passed = stableStringify(actual) === stableStringify(value);
  return {
    type: "field-equals",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? `Field "${path}" equals expected value` : `Field "${path}" did not equal expected value`,
  };
}

function assertNumericRange(output: unknown, path: string | undefined, value: unknown): EvalSuiteAssertionResult {
  const target = path ? getPath(output, path) : output;
  const number = typeof target === "number" ? target : Number(target);
  const range = value && typeof value === "object" ? value as { min?: number; max?: number } : {};

  if (Number.isNaN(number)) {
    return { type: "numeric-range", passed: false, score: 0, reason: "Value is not numeric" };
  }

  const minOk = range.min === undefined || number >= range.min;
  const maxOk = range.max === undefined || number <= range.max;
  const passed = minOk && maxOk;
  return {
    type: "numeric-range",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? "Value is in range" : `Value ${number} is outside range`,
  };
}

function assertToolCalled(toolCalls: ToolCallRecord[], value: unknown): EvalSuiteAssertionResult {
  const toolName = String(value ?? "");
  const passed = toolCalls.some((call) => call.name === toolName);
  return {
    type: "tool-called",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? `Tool "${toolName}" was called` : `Tool "${toolName}" was not called`,
  };
}

function assertMaxLatency(duration: number, value: unknown): EvalSuiteAssertionResult {
  const max = Number(value);
  if (Number.isNaN(max)) {
    return { type: "max-latency", passed: false, score: 0, reason: "Max latency must be a number in milliseconds" };
  }
  const passed = duration <= max;
  return {
    type: "max-latency",
    passed,
    score: passed ? 1 : Math.max(0, max / Math.max(duration, 1)),
    reason: `${duration}ms elapsed; max is ${max}ms`,
  };
}

async function assertLLMRubric(
  assertion: EvalSuiteAssertion,
  ctx: AssertionContext,
): Promise<EvalSuiteAssertionResult> {
  if (!ctx.modelProvider) {
    return { type: "llm-rubric", passed: false, score: 0, reason: "LLM rubric requires a model provider" };
  }

  const rubric = [ctx.suite.rubric, assertion.value].filter(Boolean).join("\n\n");
  const prompt = `You are judging an AI agent response. Score it from 0.0 to 1.0 against the rubric.

Rubric:
${rubric}

Input:
${stringify(ctx.testCase.input)}

Output:
${stringify(ctx.output)}

Respond with only JSON:
{"score":0.0,"reason":"brief reason"}`;

  return runJudge("llm-rubric", prompt, ctx);
}

async function assertSemanticSimilar(
  assertion: EvalSuiteAssertion,
  ctx: AssertionContext,
): Promise<EvalSuiteAssertionResult> {
  if (!ctx.modelProvider) {
    const score = jaccardSimilarity(stringify(ctx.output), stringify(assertion.value));
    return {
      type: "semantic-similar",
      passed: score >= ctx.suite.passThreshold,
      score,
      reason: `Jaccard similarity ${(score * 100).toFixed(1)}%`,
    };
  }

  const prompt = `Compare the expected and actual outputs for semantic equivalence. Score from 0.0 to 1.0.

Expected:
${stringify(assertion.value)}

Actual:
${stringify(ctx.output)}

Respond with only JSON:
{"score":0.0,"reason":"brief reason"}`;

  return runJudge("semantic-similar", prompt, ctx);
}

async function runJudge(
  type: "llm-rubric" | "semantic-similar",
  prompt: string,
  ctx: AssertionContext,
): Promise<EvalSuiteAssertionResult> {
  const model = ctx.suite.judgeModel ?? ctx.defaultJudgeModel ?? { provider: "openai", name: "gpt-5.4-mini" };
  try {
    const result = await ctx.modelProvider!.generateText({
      model,
      messages: [{ role: "user", content: prompt }],
      signal: ctx.signal,
    });
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { type, passed: false, score: 0, reason: `Failed to parse judge response: ${result.text}` };
    }
    const parsed = JSON.parse(match[0]) as { score?: number; reason?: string };
    const score = clampScore(parsed.score);
    return {
      type,
      passed: score >= ctx.suite.passThreshold,
      score,
      reason: parsed.reason ?? "No judge reason provided",
    };
  } catch (error) {
    return {
      type,
      passed: false,
      score: 0,
      reason: `Judge error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateJsonSchema(value: unknown, schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return ["Schema must be an object"];
  const s = schema as Record<string, unknown>;
  const errors: string[] = [];

  if (s.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [`${path} must be an object`];
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(s.required) ? s.required : [];
    for (const key of required) {
      if (typeof key === "string" && obj[key] === undefined) {
        errors.push(`${path}.${key} is required`);
      }
    }
    const properties = s.properties;
    if (properties && typeof properties === "object") {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (obj[key] !== undefined) {
          errors.push(...validateJsonSchema(obj[key], propSchema, `${path}.${key}`));
        }
      }
    }
  } else if (s.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
  } else if (s.type === "string") {
    if (typeof value !== "string") return [`${path} must be a string`];
  } else if (s.type === "number" || s.type === "integer") {
    if (typeof value !== "number") return [`${path} must be a number`];
    if (s.type === "integer" && !Number.isInteger(value)) return [`${path} must be an integer`];
  } else if (s.type === "boolean") {
    if (typeof value !== "boolean") return [`${path} must be a boolean`];
  }

  return errors;
}

function weightedScore(results: EvalSuiteAssertionResult[], assertions: EvalSuiteAssertion[]): number {
  if (results.length === 0) return 1;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < results.length; i++) {
    const weight = assertions[i]?.weight ?? 1;
    weighted += results[i].score * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 1;
}

function summarize(results: EvalSuiteCaseResult[]) {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const failed = total - passed;
  const score = total > 0 ? results.reduce((sum, result) => sum + result.score, 0) / total : 1;
  return { total, passed, failed, score };
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",")}}`;
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function clampScore(score: unknown): number {
  const n = typeof score === "number" ? score : Number(score);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}
