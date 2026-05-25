// POST /api/mcp-tools — list tools on an arbitrary MCP server URL.
//
// Used by the inline MCP picker in the agent editor: the caller supplies
// a URL (and optional headers), the server connects, lists the tools, and
// returns the names. Mirrors GET /api/mcp-servers/[id]/tools but doesn't
// require a registered connection.
//
// The same auth gate as the catalog endpoints applies — only signed-in
// users with a runner can hit this.

import { NextRequest, NextResponse } from "next/server";
import {
  OutboundUrlPolicyError,
  listToolsOnServer,
  validateOutboundUrl,
} from "@agntz/core";
import { AuthRequiredError, requireUserContext } from "@/lib/user";

interface RequestBody {
  url?: unknown;
  headers?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    await requireUserContext();

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.url !== "string" || body.url.trim() === "") {
      return NextResponse.json({ error: "Missing 'url' string" }, { status: 400 });
    }

    try {
      validateOutboundUrl(body.url);
    } catch (err) {
      const message = err instanceof OutboundUrlPolicyError
        ? err.message
        : `Invalid URL: ${body.url}`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const headers = normalizeHeaders(body.headers);

    try {
      const tools = await listToolsOnServer(
        { url: body.url, headers },
        { timeoutMs: 5_000 },
      );
      return NextResponse.json({ tools });
    } catch (err) {
      // Surface the underlying error so the picker can show "couldn't reach
      // server" or "auth failed". Still HTTP 200 with empty tools so the UI
      // can render the message without throwing.
      return NextResponse.json(
        { tools: [], error: `Could not list tools: ${(err as Error).message}` },
        { status: 200 },
      );
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
