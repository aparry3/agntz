import { NextRequest, NextResponse } from "next/server";
import { isAliasName } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { getVersion, removeAlias, setAlias } from "@/lib/versions";

// PUT body: { createdAt: "<ISO timestamp>" } — points the alias at that version.
// Idempotent: re-PUTting moves the alias to the new version (last write wins).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; alias: string }> }
) {
  try {
    const { id, alias: rawAlias } = await params;
    const alias = decodeURIComponent(rawAlias);

    if (!isAliasName(alias)) {
      return NextResponse.json(
        { error: `Invalid alias "${alias}". Must start with a letter or digit; allowed: letters, digits, '.', '_', '-'. Reserved: "latest".` },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as { createdAt?: string };
    if (!body.createdAt) {
      return NextResponse.json(
        { error: "Body must include createdAt (the version timestamp)." },
        { status: 400 }
      );
    }

    const { store } = await requireUserContext();
    const exists = await getVersion(store, id, body.createdAt);
    if (!exists) {
      return NextResponse.json(
        { error: `Version not found for agent "${id}" at ${body.createdAt}` },
        { status: 404 }
      );
    }

    await setAlias(store, id, body.createdAt, alias);
    return NextResponse.json({ agentId: id, alias, createdAt: body.createdAt });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; alias: string }> }
) {
  try {
    const { id, alias: rawAlias } = await params;
    const alias = decodeURIComponent(rawAlias);
    const { store } = await requireUserContext();
    await removeAlias(store, id, alias);
    return NextResponse.json({ agentId: id, alias, removed: true });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
