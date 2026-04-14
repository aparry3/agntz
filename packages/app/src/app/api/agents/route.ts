import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";
import { validateManifest } from "@agent-runner/manifest";

export async function GET() {
  try {
    const { runner } = await requireWorkspaceContext();
    const agents = await runner.agents.listAgents();
    return NextResponse.json(agents);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { runner } = await requireWorkspaceContext();
    const body = await req.json();
    const { id, name, manifest, ...rest } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
    }
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

    return NextResponse.json({ id, created: true, warnings: validation.warnings }, { status: 201 });
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
