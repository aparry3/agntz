import { NextRequest, NextResponse } from "next/server";
import { workerRun } from "@/lib/worker-client";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const body = await req.json();
    const { description, currentManifest } = body;

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { error: "Missing required field: description (string)" },
        { status: 400 }
      );
    }

    let fullDescription = description;
    if (currentManifest) {
      fullDescription = `Current manifest:\n\`\`\`yaml\n${currentManifest}\n\`\`\`\n\nRequested changes: ${description}`;
    }

    const result = await workerRun({
      userId,
      agentId: "system:agent-builder",
      input: { description: fullDescription },
    });

    const output = result.output as Record<string, unknown>;

    return NextResponse.json({
      yaml: output.yaml ?? null,
      explanation: output.explanation ?? null,
      validation: output.validation ?? null,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: `Agent builder failed: ${String(error)}` },
      { status: 500 }
    );
  }
}
