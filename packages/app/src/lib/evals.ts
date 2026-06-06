import { generateId } from "@agntz/core";
import type {
	EvalDataset,
	EvalDefinition,
	EvalRunListFilters,
} from "@agntz/core";

export function normalizeEvalDefinition(
	body: Partial<EvalDefinition>,
	fallbackId?: string,
): EvalDefinition {
	const id =
		stringOrUndefined(fallbackId) ??
		stringOrUndefined(body.id) ??
		generateId("eval");
	const agentId = stringOrUndefined(body.agentId);
	if (!agentId) throw new Error("Missing required field: agentId");
	const name = stringOrUndefined(body.name) ?? id;
	const criteria = Array.isArray(body.criteria)
		? body.criteria.map((criterion, index) => ({
				id:
					stringOrUndefined(criterion?.id) ??
					`criterion_${String(index + 1).padStart(2, "0")}`,
				name: stringOrUndefined(criterion?.name) ?? `Criterion ${index + 1}`,
				rubric:
					stringOrUndefined(criterion?.rubric) ??
					stringOrUndefined(criterion?.description),
				description: stringOrUndefined(criterion?.description),
				weight:
					typeof criterion?.weight === "number" ? criterion.weight : undefined,
				gate: normalizeGate(criterion?.gate, criterion?.threshold),
				threshold:
					typeof criterion?.threshold === "number"
						? criterion.threshold
						: undefined,
			}))
		: [];
	const defaultDataset = normalizeDefaultDataset(body);
	const passPolicy = normalizePassPolicy(body);
	const judge = normalizeJudge(body);
	return {
		id,
		agentId,
		name,
		description: stringOrUndefined(body.description),
		criteria,
		defaultDataset,
		defaultDatasetId:
			defaultDataset?.id ?? stringOrUndefined(body.defaultDatasetId),
		passPolicy,
		passThreshold:
			typeof body.passThreshold === "number" ? body.passThreshold : undefined,
		judge,
		judgeModel: body.judgeModel,
		metadata: isRecord(body.metadata) ? body.metadata : undefined,
		version: body.version,
		createdAt: body.createdAt,
		updatedAt: body.updatedAt,
	};
}

export function normalizeEvalDataset(
	body: Partial<EvalDataset>,
	fallbackId?: string,
): EvalDataset {
	const id =
		stringOrUndefined(fallbackId) ??
		stringOrUndefined(body.id) ??
		generateId("dataset");
	const agentId = stringOrUndefined(body.agentId);
	if (!agentId) throw new Error("Missing required field: agentId");
	const name = stringOrUndefined(body.name) ?? id;
	const items = Array.isArray(body.items)
		? body.items.map((item, index) => ({
				id:
					stringOrUndefined(item?.id) ??
					`case_${String(index + 1).padStart(3, "0")}`,
				input:
					typeof item?.input === "string" ||
					Array.isArray(item?.input) ||
					isRecord(item?.input)
						? item.input
						: JSON.stringify(item?.input ?? ""),
				reference: item?.reference ?? item?.expected,
				expected: item?.expected ?? item?.reference,
				tags: normalizeTags(item?.tags),
				notes: stringOrUndefined(item?.notes),
				metadata: isRecord(item?.metadata) ? item.metadata : undefined,
			}))
		: [];
	return {
		id,
		agentId,
		name,
		description: stringOrUndefined(body.description),
		items,
		metadata: isRecord(body.metadata) ? body.metadata : undefined,
		version: body.version,
		createdAt: body.createdAt,
		updatedAt: body.updatedAt,
	};
}

export async function assertEvalDatasetScope(
	store: {
		getDataset(datasetId: string): Promise<EvalDataset | null>;
	},
	definition: EvalDefinition,
): Promise<void> {
	const datasetId =
		definition.defaultDataset?.id ?? definition.defaultDatasetId;
	if (!datasetId) return;
	const dataset = await store.getDataset(datasetId);
	if (!dataset) {
		throw new Error(`Dataset "${datasetId}" not found`);
	}
	if (dataset.agentId !== definition.agentId) {
		throw new Error(
			`Dataset "${dataset.id}" belongs to agent "${dataset.agentId}", not "${definition.agentId}"`,
		);
	}
}

export function evalRunFiltersFromSearch(
	searchParams: URLSearchParams,
): EvalRunListFilters {
	const limitRaw = searchParams.get("limit");
	const limit = limitRaw ? Number(limitRaw) : undefined;
	return {
		agentId: searchParams.get("agentId") ?? undefined,
		evalId: searchParams.get("evalId") ?? undefined,
		evalVersion: searchParams.get("evalVersion") ?? undefined,
		datasetId: searchParams.get("datasetId") ?? undefined,
		datasetVersion: searchParams.get("datasetVersion") ?? undefined,
		agentVersion: searchParams.get("agentVersion") ?? undefined,
		status:
			(searchParams.get("status") as EvalRunListFilters["status"] | null) ??
			undefined,
		startedAfter: searchParams.get("startedAfter") ?? undefined,
		startedBefore: searchParams.get("startedBefore") ?? undefined,
		cursor: searchParams.get("cursor") ?? undefined,
		limit: Number.isFinite(limit) ? limit : undefined,
	};
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeGate(
	gate: unknown,
	threshold: unknown,
): { minimumScore: number } | undefined {
	if (isRecord(gate) && typeof gate.minimumScore === "number") {
		return { minimumScore: gate.minimumScore };
	}
	if (typeof threshold === "number") return { minimumScore: threshold };
	return undefined;
}

function normalizePassPolicy(
	body: Partial<EvalDefinition>,
): { minimumScore?: number } | undefined {
	if (
		isRecord(body.passPolicy) &&
		typeof body.passPolicy.minimumScore === "number"
	) {
		return { minimumScore: body.passPolicy.minimumScore };
	}
	if (typeof body.passThreshold === "number") {
		return { minimumScore: body.passThreshold };
	}
	return undefined;
}

function normalizeJudge(
	body: Partial<EvalDefinition>,
): EvalDefinition["judge"] {
	if (isRecord(body.judge) && isRecord(body.judge.model)) {
		return {
			model: body.judge.model as unknown as EvalDefinition["judgeModel"],
		};
	}
	if (body.judgeModel) return { model: body.judgeModel };
	return undefined;
}

function normalizeDefaultDataset(
	body: Partial<EvalDefinition>,
): EvalDefinition["defaultDataset"] {
	if (isRecord(body.defaultDataset)) {
		const id = stringOrUndefined(body.defaultDataset.id);
		if (id) {
			return {
				id,
				version: stringOrUndefined(body.defaultDataset.version),
			};
		}
	}
	const id = stringOrUndefined(body.defaultDatasetId);
	return id ? { id } : undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const tags = value
		.map((tag) => (typeof tag === "string" ? tag.trim() : ""))
		.filter(Boolean);
	return tags.length > 0 ? tags : undefined;
}
