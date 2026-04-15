import { NextRequest, NextResponse } from "next/server";
import { validateManifestFull } from "@agntz/manifest";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { buildValidationContext } from "@/lib/validation-context";

export async function POST(req: NextRequest) {
  try {
    const { runner } = await requireUserContext();
    const body = await req.json();
    const { manifest } = body;

    if (!manifest || typeof manifest !== "string") {
      return NextResponse.json(
        { error: "Missing required field: manifest (string)" },
        { status: 400 }
      );
    }

    const ctx = buildValidationContext(runner);
    const result = await validateManifestFull(manifest, ctx);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
