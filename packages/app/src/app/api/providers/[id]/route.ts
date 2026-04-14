import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireWorkspaceContext();
    if (!runner.providers) {
      return NextResponse.json({ error: "Provider store not available" }, { status: 501 });
    }

    const provider = await runner.providers.getProvider(id);
    if (!provider) {
      return NextResponse.json({ id, configured: false });
    }

    return NextResponse.json({
      id: provider.id,
      configured: true,
      apiKeyPreview: maskKey(provider.apiKey),
      baseUrl: provider.baseUrl,
      config: provider.config,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireWorkspaceContext();
    if (!runner.providers) {
      return NextResponse.json({ error: "Provider store not available" }, { status: 501 });
    }

    const body = await req.json();
    const { apiKey, baseUrl, config } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing required field: apiKey" }, { status: 400 });
    }

    await runner.providers.putProvider({ id, apiKey, baseUrl, config });
    return NextResponse.json({ id, configured: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { runner } = await requireWorkspaceContext();
    if (!runner.providers) {
      return NextResponse.json({ error: "Provider store not available" }, { status: 501 });
    }

    await runner.providers.deleteProvider(id);
    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}
