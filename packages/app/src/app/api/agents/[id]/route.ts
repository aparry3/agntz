import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireUserContext();
    const agent = await runner.agents.getAgent(id);

    if (!agent) {
      return NextResponse.json({ error: `Agent "${id}" not found` }, { status: 404 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId, runner } = await requireUserContext();
    const body = await req.json();
    const { name, manifest, ...rest } = body;

    if (!manifest) {
      return NextResponse.json({ error: "Missing required field: manifest" }, { status: 400 });
    }

    const validation = await workerValidateManifest({ userId, manifest, strict: true });
    if (validation.errors.length > 0) {
      return NextResponse.json(
        { error: "Invalid manifest", errors: validation.errors, warnings: validation.warnings },
        { status: 400 }
      );
    }

    await runner.agents.putAgent({
      id,
      name: name ?? id,
      systemPrompt: "",
      model: { provider: "openai", name: "gpt-5.4" },
      metadata: { manifest, ...rest },
    });

    return NextResponse.json({ id, updated: true, warnings: validation.warnings });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireUserContext();
    await runner.agents.deleteAgent(id);
    return NextResponse.json({ id, deleted: true });
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
