import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";

export async function GET() {
  try {
    const { runner } = await requireUserContext();
    const agents = await runner.agents.listAgents();
    return NextResponse.json(agents);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, runner } = await requireUserContext();
    const body = await req.json();
    const { id, name, manifest, ...rest } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
    }
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

    return NextResponse.json({ id, created: true, warnings: validation.warnings }, { status: 201 });
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
