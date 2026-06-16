/**
 * Pure, store-agnostic helpers for eval-run history that backends (the SQL
 * stores) and core share. Kept in contracts so the store adapters can filter,
 * sort, and paginate in-memory eval-run rows without depending on `@agntz/core`.
 */
import type {
	EvalRun,
	EvalRunListFilters,
	EvalRunListResult,
} from "./types.js";

/**
 * Sentinel prefix used by SQL stores to encode a `ContentBlock[]`
 * `InvocationLog.input` inside the legacy `input TEXT` column without a second
 * column. Shared so all stores stay in lockstep.
 */
export const INVOCATION_LOG_BLOCKS_PREFIX = "__agntz_blocks__:";

/**
 * Filter, sort (startedAt DESC, id DESC), and paginate eval-run rows in-memory.
 * Backends that hold runs as opaque JSON (or that lack rich SQL paging) call
 * this after loading the candidate rows. The cursor is opaque base64url JSON
 * `{ startedAt, id }`.
 */
export function listEvalRunsInProcess(
	runs: EvalRun[],
	filters: EvalRunListFilters = {},
): EvalRunListResult {
	const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
	let rows = runs.filter((run) => {
		if (filters.agentId && run.agentId !== filters.agentId) return false;
		if (filters.evalId && run.evalId !== filters.evalId) return false;
		if (filters.evalVersion && run.evalVersion !== filters.evalVersion)
			return false;
		if (filters.datasetId && run.datasetId !== filters.datasetId) return false;
		if (filters.datasetVersion && run.datasetVersion !== filters.datasetVersion)
			return false;
		if (filters.agentVersion && run.agentVersion !== filters.agentVersion)
			return false;
		if (filters.status && run.status !== filters.status) return false;
		if (filters.startedAfter && run.startedAt < filters.startedAfter)
			return false;
		if (filters.startedBefore && run.startedAt > filters.startedBefore)
			return false;
		return true;
	});
	rows = rows
		.slice()
		.sort(
			(a, b) =>
				b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
		);

	let startIdx = 0;
	if (filters.cursor) {
		const decoded = decodeEvalRunCursor(filters.cursor);
		if (decoded) {
			startIdx = rows.findIndex(
				(r) =>
					r.startedAt < decoded.startedAt ||
					(r.startedAt === decoded.startedAt && r.id < decoded.id),
			);
			if (startIdx === -1) startIdx = rows.length;
		}
	}

	const page = rows.slice(startIdx, startIdx + limit);
	const cursor =
		page.length === limit && startIdx + limit < rows.length
			? encodeEvalRunCursor({
					startedAt: page[page.length - 1].startedAt,
					id: page[page.length - 1].id,
				})
			: undefined;
	return { rows: page, cursor };
}

function encodeEvalRunCursor(cursor: {
	startedAt: string;
	id: string;
}): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeEvalRunCursor(
	cursor: string,
): { startedAt: string; id: string } | null {
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		) as { startedAt?: unknown; id?: unknown };
		if (typeof parsed.startedAt !== "string" || typeof parsed.id !== "string")
			return null;
		return { startedAt: parsed.startedAt, id: parsed.id };
	} catch {
		return null;
	}
}
