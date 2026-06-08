import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerEditAgent, workerValidateManifest } from "@/lib/worker-client";
import type { ManifestSelection } from "@agntz/manifest";
import { type NextRequest, NextResponse } from "next/server";
import { parse as parseYAML } from "yaml";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestIdOf(yaml: string): string | null {
	const parsed = parseYAML(yaml);
	return isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : null;
}

export async function POST(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const { userId, runner } = await requireUserContext();
		const existing = await runner.agents.getAgent(id);
		if (!existing) {
			return NextResponse.json(
				{ error: `Agent "${id}" not found` },
				{ status: 404 },
			);
		}

		const body = await req.json();
		const { currentManifest, changeDescription, selection } = body;

		if (!currentManifest || typeof currentManifest !== "string") {
			return NextResponse.json(
				{ error: "Missing required field: currentManifest (string)" },
				{ status: 400 },
			);
		}
		if (!changeDescription || typeof changeDescription !== "string") {
			return NextResponse.json(
				{ error: "Missing required field: changeDescription (string)" },
				{ status: 400 },
			);
		}

		const currentId = manifestIdOf(currentManifest);
		if (!currentId) {
			return NextResponse.json(
				{ error: "currentManifest must be valid YAML with a top-level id" },
				{ status: 400 },
			);
		}

		const result = await workerEditAgent({
			currentManifest,
			changeDescription,
			selection: selection as ManifestSelection | undefined,
		});
		if (!result.yaml) {
			return NextResponse.json(
				{
					error: "Agent editor did not return a YAML manifest",
					explanation: result.explanation,
					validation: result.validation,
				},
				{ status: 502 },
			);
		}

		const nextId = manifestIdOf(result.yaml);
		if (nextId !== currentId) {
			return NextResponse.json(
				{
					error: `Edited manifest changed top-level id from "${currentId}" to "${nextId ?? "(missing)"}"`,
					explanation: result.explanation,
				},
				{ status: 422 },
			);
		}

		const validation = await workerValidateManifest({
			userId,
			manifest: result.yaml,
			strict: true,
		});
		if (validation.errors.length > 0) {
			return NextResponse.json(
				{
					error: "Edited manifest is invalid",
					errors: validation.errors,
					warnings: validation.warnings,
					explanation: result.explanation,
				},
				{ status: 422 },
			);
		}

		return NextResponse.json({
			yaml: result.yaml,
			explanation: result.explanation,
			validation,
		});
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json({ error: String(error) }, { status: 500 });
	}
}
