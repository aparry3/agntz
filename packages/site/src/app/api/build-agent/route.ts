import { type NextRequest, NextResponse } from "next/server";
import { parse as parseYAML } from "yaml";

const DEFAULT_BUILD_API_URL = "https://api.agntz.co";
const MAX_DESCRIPTION_LENGTH = 4096;

interface BuildMetadata {
	id?: string;
	name?: string;
	kind?: string;
	modelProvider?: string;
	modelName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function buildApiUrl(): string {
	return (
		process.env.AGNTZ_BUILD_API_URL?.replace(/\/$/, "") ?? DEFAULT_BUILD_API_URL
	);
}

function readMetadata(yaml: unknown): BuildMetadata {
	if (typeof yaml !== "string") return {};
	try {
		const parsed = parseYAML(yaml);
		if (!isRecord(parsed)) return {};
		const out: BuildMetadata = {};
		if (typeof parsed.id === "string") out.id = parsed.id;
		if (typeof parsed.name === "string") out.name = parsed.name;
		if (typeof parsed.kind === "string") out.kind = parsed.kind;
		if (isRecord(parsed.model)) {
			if (typeof parsed.model.provider === "string") {
				out.modelProvider = parsed.model.provider;
			}
			if (typeof parsed.model.name === "string")
				out.modelName = parsed.model.name;
		}
		return out;
	} catch {
		return {};
	}
}

export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as {
		description?: unknown;
		currentManifest?: unknown;
	};

	if (!body.description || typeof body.description !== "string") {
		return NextResponse.json(
			{ error: "Missing required field: description (string)" },
			{ status: 400 },
		);
	}

	if (body.description.length > MAX_DESCRIPTION_LENGTH) {
		return NextResponse.json(
			{
				error: `description exceeds max length of ${MAX_DESCRIPTION_LENGTH} characters`,
			},
			{ status: 413 },
		);
	}

	if (
		body.currentManifest != null &&
		typeof body.currentManifest !== "string"
	) {
		return NextResponse.json(
			{ error: "currentManifest must be a string when provided" },
			{ status: 400 },
		);
	}

	const upstream = await fetch(`${buildApiUrl()}/build-agent`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			description: body.description,
			...(body.currentManifest
				? { currentManifest: body.currentManifest }
				: {}),
		}),
	});

	const data = await upstream.json().catch(() => ({}));
	const headers = new Headers();
	const retryAfter = upstream.headers.get("retry-after");
	if (retryAfter) headers.set("Retry-After", retryAfter);

	if (!upstream.ok) {
		return NextResponse.json(data, { status: upstream.status, headers });
	}

	return NextResponse.json(
		{
			...data,
			metadata: readMetadata((data as { yaml?: unknown }).yaml),
		},
		{ status: 200, headers },
	);
}
