import { AuthRequiredError, requireUserContext, workerIdentity } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The agent id in this route addresses an agent *record*, not a specific
 * version. `@version` syntax belongs on the run path (POST /api/run with
 * `agentId: "foo@latest"`) and the versions subresource — reject it here so
 * a CRUD call against `foo@latest` doesn't silently target whatever record
 * happens to match.
 */
function rejectVersionSuffix(id: string): NextResponse | null {
	if (id.includes("@")) {
		return NextResponse.json(
			{
				error: `Agent id "${id}" must not contain '@'. Version syntax is supported on POST /api/run and the /versions subresource, not on this endpoint.`,
			},
			{ status: 400 },
		);
	}
	return null;
}

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const bad = rejectVersionSuffix(id);
		if (bad) return bad;
		const { runner } = await requireUserContext();
		const agent = await runner.agents.getAgent(id);

		if (!agent) {
			return NextResponse.json(
				{ error: `Agent "${id}" not found` },
				{ status: 404 },
			);
		}

		return NextResponse.json(agent);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const bad = rejectVersionSuffix(id);
		if (bad) return bad;
		const ctx = await requireUserContext();
		const { runner } = ctx;
		const body = await req.json();
		const { name, manifest, ...rest } = body;

		if (!manifest) {
			return NextResponse.json(
				{ error: "Missing required field: manifest" },
				{ status: 400 },
			);
		}

		const validation = await workerValidateManifest({
			...workerIdentity(ctx),
			manifest,
			strict: true,
		});
		if (validation.errors.length > 0) {
			return NextResponse.json(
				{
					error: "Invalid manifest",
					errors: validation.errors,
					warnings: validation.warnings,
				},
				{ status: 400 },
			);
		}

		await runner.agents.putAgent({
			id,
			name: name ?? id,
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
			metadata: { manifest, ...rest },
		});

		return NextResponse.json({
			id,
			updated: true,
			warnings: validation.warnings,
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const bad = rejectVersionSuffix(id);
		if (bad) return bad;
		const { runner } = await requireUserContext();
		await runner.agents.deleteAgent(id);
		return NextResponse.json({ id, deleted: true });
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
