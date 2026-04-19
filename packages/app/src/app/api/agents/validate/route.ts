import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const body = await req.json();
    const { manifest } = body;

    if (!manifest || typeof manifest !== "string") {
      return NextResponse.json(
        { error: "Missing required field: manifest (string)" },
        { status: 400 }
      );
    }

    const result = await workerValidateManifest({ userId, manifest });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
