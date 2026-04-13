import { NextRequest, NextResponse } from "next/server";
import { validateManifest } from "@agent-runner/manifest";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { manifest } = body;

    if (!manifest || typeof manifest !== "string") {
      return NextResponse.json(
        { error: "Missing required field: manifest (string)" },
        { status: 400 }
      );
    }

    const result = validateManifest(manifest);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
