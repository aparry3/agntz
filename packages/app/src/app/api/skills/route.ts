import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET() {
  try {
    const { store } = await requireUserContext();
    const skills = await store.listSkills();
    return NextResponse.json(skills);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { store } = await requireUserContext();
    const body = await req.json();
    const { name, description, instructions, tools, metadata } = body ?? {};

    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const existing = await store.getSkill(name);
    if (existing) {
      return NextResponse.json(
        { error: `Skill "${name}" already exists` },
        { status: 409 },
      );
    }

    try {
      await store.putSkill({ name, description, instructions, tools, metadata });
    } catch (err) {
      return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
    }

    return NextResponse.json({ name, created: true }, { status: 201 });
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
