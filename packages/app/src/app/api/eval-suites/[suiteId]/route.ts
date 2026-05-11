import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { EvalSuiteCase } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> }
) {
  try {
    const { suiteId } = await params;
    const { store } = await requireUserContext();
    const suite = await store.getEvalSuite(suiteId);
    if (!suite) {
      return NextResponse.json({ error: `Eval suite "${suiteId}" not found` }, { status: 404 });
    }
    return NextResponse.json(suite);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> }
) {
  try {
    const { suiteId } = await params;
    const { store } = await requireUserContext();
    const existing = await store.getEvalSuite(suiteId);
    if (!existing) {
      return NextResponse.json({ error: `Eval suite "${suiteId}" not found` }, { status: 404 });
    }

    const body = await req.json();
    const next = {
      ...existing,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name,
      description: typeof body.description === "string" ? body.description : existing.description,
      rubric: typeof body.rubric === "string" ? body.rubric : existing.rubric,
      judgeModel: body.judgeModel && typeof body.judgeModel === "object" ? body.judgeModel : existing.judgeModel,
      passThreshold: normalizeThreshold(body.passThreshold ?? existing.passThreshold),
      cases: Array.isArray(body.cases) ? normalizeCases(body.cases) : existing.cases,
      updatedAt: new Date().toISOString(),
    };

    await store.putEvalSuite(next);
    return NextResponse.json(next);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> }
) {
  try {
    const { suiteId } = await params;
    const { store } = await requireUserContext();
    await store.deleteEvalSuite(suiteId);
    return NextResponse.json({ id: suiteId, deleted: true });
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
