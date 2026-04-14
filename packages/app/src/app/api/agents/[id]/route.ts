import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";
import { validateManifest } from "@agent-runner/manifest";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireWorkspaceContext();
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
    const { runner } = await requireWorkspaceContext();
    const body = await req.json();
    const { name, manifest, ...rest } = body;

    if (!manifest) {
      return NextResponse.json({ error: "Missing required field: manifest" }, { status: 400 });
    }

    const validation = validateManifest(manifest);
    const structuralErrors = validation.errors.filter((e) => e.level === "structural");
    if (structuralErrors.length > 0) {
      return NextResponse.json(
        { error: "Invalid manifest", errors: structuralErrors },
        { status: 400 }
      );
    }

    await runner.agents.putAgent({
      id,
      name: name ?? id,
      systemPrompt: "",
      model: { provider: "openai", name: "gpt-4o" },
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
    const { runner } = await requireWorkspaceContext();
    await runner.agents.deleteAgent(id);
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
