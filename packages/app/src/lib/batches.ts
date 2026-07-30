import type { BatchDefinition } from "@agntz/core";
import { parseBatchManifest } from "@agntz/core/manifest";
import { NextResponse } from "next/server";
import { AuthRequiredError } from "./user";

export function normalizeBatchDefinition(
	value: unknown,
	forcedId?: string,
): BatchDefinition {
	const body = value as { manifest?: unknown };
	if (typeof body?.manifest !== "string" || !body.manifest.trim()) {
		throw new Error("Missing required field: manifest (YAML string)");
	}
	const manifest = parseBatchManifest(body.manifest);
	if (forcedId && manifest.id !== forcedId) {
		throw new Error(
			`Batch manifest id '${manifest.id}' must match route id '${forcedId}'`,
		);
	}
	return {
		id: forcedId ?? manifest.id,
		name: manifest.name,
		description: manifest.description,
		manifest: body.manifest,
		provider: manifest.model.provider,
		model: manifest.model.name,
		defaultDataset: manifest.defaultDataset,
	};
}

export async function workerResponse(
	response: Response,
): Promise<NextResponse> {
	const body = await response.arrayBuffer();
	return new NextResponse(body, {
		status: response.status,
		headers: {
			"content-type":
				response.headers.get("content-type") ?? "application/json",
			...(response.headers.get("content-disposition")
				? {
						"content-disposition": response.headers.get(
							"content-disposition",
						) as string,
					}
				: {}),
		},
	});
}

export function batchErrorResponse(error: unknown): NextResponse {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	const status =
		message.startsWith("Missing required field") ||
		message.includes("must match") ||
		message.includes("manifest")
			? 400
			: 500;
	return NextResponse.json({ error: message }, { status });
}
