import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { parse as parseYAML } from "yaml";
import type { EvalSuite, EvalSuiteCase } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireUserContext();
    const body = await req.json();
    const rubric = typeof body.rubric === "string" ? body.rubric.trim() : "";
    if (!rubric) {
      return NextResponse.json({ error: "Missing required field: rubric" }, { status: 400 });
    }

    const agent = await runner.agents.getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: `Agent "${id}" not found` }, { status: 404 });
    }

    const manifest = typeof agent.metadata?.manifest === "string" ? agent.metadata.manifest : "";
    const parsed = parseManifestSafe(manifest);
    const fallback = buildFallbackSuite(id, parsed, rubric);

    try {
      const result = await runner.model.generateText({
        model: {
          provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
          name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
        },
        messages: [
          {
            role: "user",
            content: buildPrompt(manifest, rubric),
          },
        ],
      });
      const generated = parseGeneratedSuite(result.text);
      return NextResponse.json({ suite: mergeGeneratedSuite(fallback, generated) });
    } catch {
      return NextResponse.json({ suite: fallback, degraded: true });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function buildPrompt(manifest: string, rubric: string): string {
  return `Create an eval suite for this agntz agent manifest.

Return only JSON with this shape:
{
  "name": "short suite name",
  "description": "one sentence",
  "cases": [
    {
      "name": "case name",
      "input": "string or JSON object matching the manifest inputSchema",
      "expectedOutput": "optional expected output",
      "assertions": [
        {"type":"llm-rubric","value":"specific judging criterion"}
      ]
    }
  ]
}

Use 5 practical cases. Prefer deterministic assertions when obvious:
- field-exists / field-equals for structured outputs
- contains / not-contains for fixed text requirements
- llm-rubric for judgment calls

Rubric:
${rubric}

Manifest:
${manifest}`;
}

function buildFallbackSuite(agentId: string, manifest: Record<string, unknown> | null, rubric: string): EvalSuite {
  const now = new Date().toISOString();
  const outputSchema = manifest?.outputSchema && typeof manifest.outputSchema === "object"
    ? manifest.outputSchema as Record<string, unknown>
    : null;
  const fieldAssertions = outputSchema
    ? Object.keys(outputSchema).slice(0, 4).map((field) => ({ type: "field-exists" as const, path: field }))
    : [];

  return {
    id: `evalsuite_${randomUUID()}`,
    agentId,
    name: "Rubric eval suite",
    description: "Generated from a plain-language rubric.",
    rubric,
    passThreshold: 0.8,
    cases: [
      {
        id: `case_${randomUUID()}`,
        name: "Primary behavior",
        input: sampleInput(manifest),
        assertions: [
          ...fieldAssertions,
          { type: "llm-rubric", value: rubric },
        ],
        enabled: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function mergeGeneratedSuite(fallback: EvalSuite, generated: Partial<EvalSuite>): EvalSuite {
  return {
    ...fallback,
    name: generated.name || fallback.name,
    description: generated.description || fallback.description,
    cases: Array.isArray(generated.cases) && generated.cases.length > 0
      ? generated.cases.map((testCase, index) => normalizeCase(testCase, index, fallback.rubric ?? ""))
      : fallback.cases,
  };
}

function normalizeCase(value: unknown, index: number, rubric: string): EvalSuiteCase {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: `case_${randomUUID()}`,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Case ${index + 1}`,
    input: raw.input ?? "",
    context: typeof raw.context === "string" ? raw.context : undefined,
    expectedOutput: raw.expectedOutput,
    assertions: Array.isArray(raw.assertions) && raw.assertions.length > 0
      ? raw.assertions as EvalSuiteCase["assertions"]
      : [{ type: "llm-rubric", value: rubric }],
    enabled: true,
  };
}

function parseGeneratedSuite(text: string): Partial<EvalSuite> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  return JSON.parse(match[0]) as Partial<EvalSuite>;
}

function parseManifestSafe(manifest: string): Record<string, unknown> | null {
  try {
    const parsed = parseYAML(manifest);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sampleInput(manifest: Record<string, unknown> | null): unknown {
  const inputSchema = manifest?.inputSchema;
  if (!inputSchema || typeof inputSchema !== "object") return "Test the agent's primary behavior.";

  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputSchema as Record<string, unknown>)) {
    const type = typeof value === "string"
      ? value
      : value && typeof value === "object" && "type" in value
        ? String((value as { type?: unknown }).type)
        : "string";
    input[key] = type === "number" ? 1 : type === "boolean" ? true : `Sample ${key}`;
  }
  return input;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
