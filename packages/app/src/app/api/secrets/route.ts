import { NextRequest, NextResponse } from "next/server";
import { getLastFour } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export async function GET() {
  try {
    const { store } = await requireUserContext();
    const secrets = await store.listSecrets();
    return NextResponse.json(secrets);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { store } = await requireUserContext();
    const body = await req.json();
    const { name, value, description } = body ?? {};

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }
    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        {
          error:
            "Invalid secret name. Must match /^[a-z][a-z0-9_]*$/ (lowercase letters, digits, underscores; starts with a letter).",
        },
        { status: 400 },
      );
    }
    if (typeof value !== "string" || value === "") {
      return NextResponse.json(
        { error: "Missing or empty required field: value" },
        { status: 400 },
      );
    }
    if (description !== undefined && typeof description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 });
    }

    const existing = await store.getSecretMetadata(name);
    if (existing) {
      return NextResponse.json(
        { error: `Secret "${name}" already exists` },
        { status: 409 },
      );
    }

    try {
      await store.putSecret({ name, value, description });
    } catch (err) {
      return NextResponse.json(
        { error: String(err instanceof Error ? err.message : err) },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { name, lastFour: getLastFour(value), created: true },
      { status: 201 },
    );
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
