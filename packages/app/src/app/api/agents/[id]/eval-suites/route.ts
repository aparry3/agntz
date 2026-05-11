import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { EvalSuite, EvalSuiteCase } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { store } = await requireUserContext();
    const suites = await store.listEvalSuites(id);
    return NextResponse.json(suites);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { store, runner } = await requireUserContext();
    const agent = await runner.agents.getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: `Agent "${id}" not found` }, { status: 404 });
    }

    const body = await req.json();
    const now = new Date().toISOString();
    const suite: EvalSuite = {
      id: typeof body.id === "string" && body.id ? body.id : `evalsuite_${randomUUID()}`,
      agentId: id,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Default eval suite",
      description: typeof body.description === "string" ? body.description : undefined,
      rubric: typeof body.rubric === "string" ? body.rubric : undefined,
      judgeModel: body.judgeModel && typeof body.judgeModel === "object" ? body.judgeModel : undefined,
      passThreshold: normalizeThreshold(body.passThreshold),
      cases: normalizeCases(body.cases),
      createdAt: now,
      updatedAt: now,
    };

    await store.putEvalSuite(suite);
    return NextResponse.json(suite);
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeCases(value: unknown): EvalSuiteCase[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const raw = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : `case_${randomUUID()}`,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Case ${index + 1}`,
      input: raw.input ?? "",
      context: typeof raw.context === "string" ? raw.context : undefined,
      expectedOutput: raw.expectedOutput,
      assertions: Array.isArray(raw.assertions) ? raw.assertions as EvalSuiteCase["assertions"] : [],
      enabled: raw.enabled === false ? false : true,
    };
  });
}

function normalizeThreshold(value: unknown): number {
  const threshold = typeof value === "number" ? value : Number(value ?? 0.7);
  if (Number.isNaN(threshold)) return 0.7;
  return Math.max(0, Math.min(1, threshold));
}

function errorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
