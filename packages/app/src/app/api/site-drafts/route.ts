import { createSiteDraft } from "@/lib/site-drafts";
import { type NextRequest, NextResponse } from "next/server";

const DEFAULT_ALLOWED_ORIGINS = [
	"https://agntz.co",
	"https://www.agntz.co",
	"http://localhost:3001",
	"http://127.0.0.1:3001",
];

function allowedOrigins(): string[] {
	const configured = process.env.SITE_DRAFT_ALLOWED_ORIGINS;
	if (!configured) return DEFAULT_ALLOWED_ORIGINS;
	return configured
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function allowedOrigin(req: NextRequest): string | null {
	const origin = req.headers.get("origin");
	if (!origin) return "";
	return allowedOrigins().includes(origin) ? origin : "";
}

function corsHeaders(origin: string | null): HeadersInit {
	return origin
		? {
				"Access-Control-Allow-Origin": origin,
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
				Vary: "Origin",
			}
		: {};
}

function appBaseUrl(req: NextRequest): string {
	const configured = process.env.NEXT_PUBLIC_AGNTZ_APP_URL;
	if (configured) return configured.replace(/\/$/, "");
	return req.nextUrl.origin;
}

export async function OPTIONS(req: NextRequest) {
	const origin = allowedOrigin(req);
	if (origin === "") {
		return new NextResponse(null, { status: 403 });
	}
	return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
	const origin = allowedOrigin(req);
	if (origin === "") {
		return NextResponse.json({ error: "origin not allowed" }, { status: 403 });
	}

	try {
		const body = (await req.json().catch(() => ({}))) as {
			yaml?: unknown;
			source?: unknown;
		};
		if (!body.yaml || typeof body.yaml !== "string") {
			return NextResponse.json(
				{ error: "Missing required field: yaml (string)" },
				{ status: 400, headers: corsHeaders(origin) },
			);
		}
		const draft = await createSiteDraft({
			yaml: body.yaml,
			source: typeof body.source === "string" ? body.source : undefined,
		});
		const baseUrl = appBaseUrl(req);
		return NextResponse.json(
			{
				draftId: draft.id,
				expiresAt: draft.expiresAt,
				openUrl: `${baseUrl}/site-drafts/${encodeURIComponent(draft.id)}`,
			},
			{ status: 201, headers: corsHeaders(origin) },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 500, headers: corsHeaders(origin) },
		);
	}
}
