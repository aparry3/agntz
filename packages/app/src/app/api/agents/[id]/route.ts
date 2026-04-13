import { NextRequest, NextResponse } from "next/server";
import { getRunner } from "@/lib/runner";
import { validateManifest } from "@agent-runner/manifest";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const runner = await getRunner();
    const agent = await runner.agents.getAgent(id);

    if (!agent) {
      return NextResponse.json({ error: `Agent "${id}" not found` }, { status: 404 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const runner = await getRunner();
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
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const runner = await getRunner();
    await runner.agents.deleteAgent(id);
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
