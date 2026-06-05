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
				description: stringOrUndefined(criterion?.description),
				weight:
					typeof criterion?.weight === "number" ? criterion.weight : undefined,
				threshold:
					typeof criterion?.threshold === "number"
						? criterion.threshold
						: undefined,
			}))
		: [];
	return {
		id,
		agentId,
		name,
		description: stringOrUndefined(body.description),
		criteria,
		defaultDatasetId: stringOrUndefined(body.defaultDatasetId),
		passThreshold:
			typeof body.passThreshold === "number" ? body.passThreshold : undefined,
		judgeModel: body.judgeModel,
		metadata: isRecord(body.metadata) ? body.metadata : undefined,
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
					typeof item?.input === "string" || Array.isArray(item?.input)
						? item.input
						: JSON.stringify(item?.input ?? ""),
				expected: item?.expected,
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
	if (!definition.defaultDatasetId) return;
	const dataset = await store.getDataset(definition.defaultDatasetId);
	if (!dataset) {
		throw new Error(`Dataset "${definition.defaultDatasetId}" not found`);
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
		datasetId: searchParams.get("datasetId") ?? undefined,
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
	return typeof value === "object" && value !== null;
}
