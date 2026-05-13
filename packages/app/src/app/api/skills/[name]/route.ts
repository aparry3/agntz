import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { store } = await requireUserContext();
    const skill = await store.getSkill(name);
    if (!skill) {
      return NextResponse.json({ error: `Skill "${name}" not found` }, { status: 404 });
    }
    return NextResponse.json(skill);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { store } = await requireUserContext();
    const body = await req.json();
    const { description, instructions, tools, metadata } = body ?? {};

    try {
      await store.putSkill({ name, description, instructions, tools, metadata });
    } catch (err) {
      return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
    }

    return NextResponse.json({ name, updated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const { name } = await params;
    const { store } = await requireUserContext();
    await store.deleteSkill(name);
    return NextResponse.json({ name, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
