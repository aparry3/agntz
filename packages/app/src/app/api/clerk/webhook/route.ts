import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { getStore } from "@/lib/store";

/**
 * Clerk → us. Subscribed to `organization.created` and `organization.updated`
 * so that workspaces stay in sync. Lazy-create in requireWorkspaceContext()
 * is the fallback if a request races the webhook.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CLERK_WEBHOOK_SIGNING_SECRET not set" }, { status: 500 });
  }

  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };
  if (!headers["svix-id"] || !headers["svix-signature"] || !headers["svix-timestamp"]) {
    return NextResponse.json({ error: "missing svix headers" }, { status: 400 });
  }

  const payload = await req.text();

  let event: { type: string; data: Record<string, unknown> };
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, headers) as typeof event;
  } catch (err) {
    return NextResponse.json({ error: `invalid signature: ${String(err)}` }, { status: 400 });
  }

  const store = await getStore();

  if (event.type === "organization.created" || event.type === "organization.updated") {
    const data = event.data as { id: string; name: string };
    await store.createWorkspace({ clerkOrgId: data.id, name: data.name });
    return NextResponse.json({ ok: true });
  }

  // Other events ignored for now.
  return NextResponse.json({ ok: true, ignored: event.type });
}
