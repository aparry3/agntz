import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";
import { parse as parseYAML } from "yaml";

interface AgentListEntry {
	id: string;
	name: string;
	description?: string;
	kind?: string;
	model?: string;
	updatedAt?: string;
	createdAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readManifestSummary(manifestSource: unknown): {
	kind?: string;
	model?: string;
} {
	if (typeof manifestSource !== "string") return {};
	try {
		const parsed = parseYAML(manifestSource);
		if (!isRecord(parsed)) return {};
		const out: { kind?: string; model?: string } = {};
		if (typeof parsed.kind === "string") out.kind = parsed.kind;
		if (isRecord(parsed.model)) {
			const provider =
				typeof parsed.model.provider === "string" ? parsed.model.provider : "";
			const name =
				typeof parsed.model.name === "string" ? parsed.model.name : "";
			if (provider || name)
				out.model = [provider, name].filter(Boolean).join(" · ");
		}
		return out;
	} catch {
		return {};
	}
}

export async function GET() {
	try {
		const { runner } = await requireUserContext();
		const summaries = await runner.agents.listAgents();

		// Enrich each summary with kind/model/updatedAt by fetching the full def.
		// Cheap for small lists; if this list grows, the store should expose a
		// richer list method instead of paying N round-trips here.
		const enriched: AgentListEntry[] = await Promise.all(
			summaries.map(async (summary) => {
				try {
					const agent = await runner.agents.getAgent(summary.id);
					if (!agent) return summary;
					const manifestSource = isRecord(agent.metadata)
						? agent.metadata.manifest
						: undefined;
					const { kind, model } = readManifestSummary(manifestSource);
					const fallbackModel =
						`${agent.model?.provider ?? ""}${agent.model?.name ? ` · ${agent.model.name}` : ""}`.trim() ||
						undefined;
					return {
						...summary,
						kind,
						model: model ?? fallbackModel,
						updatedAt: agent.updatedAt,
						createdAt: agent.createdAt,
					};
				} catch {
					return summary;
				}
			}),
		);

		return NextResponse.json(enriched);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { userId, runner } = await requireUserContext();
		const body = await req.json();
		const { id, name, manifest, ...rest } = body;

		if (!id) {
			return NextResponse.json(
				{ error: "Missing required field: id" },
				{ status: 400 },
			);
		}
		if (!manifest) {
			return NextResponse.json(
				{ error: "Missing required field: manifest" },
				{ status: 400 },
			);
		}

		const validation = await workerValidateManifest({
			userId,
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

		return NextResponse.json(
			{ id, created: true, warnings: validation.warnings },
			{ status: 201 },
		);
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
