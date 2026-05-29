import type { Run, RunListFilters, RunListResult } from "../types.js";

interface Cursor {
	startedAt: number;
	id: string;
}

function encodeCursor(c: Cursor): string {
	return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(s: string): Cursor | null {
	try {
		const decoded = JSON.parse(
			Buffer.from(s, "base64url").toString("utf8"),
		) as Cursor;
		if (typeof decoded.startedAt !== "number" || typeof decoded.id !== "string")
			return null;
		return decoded;
	} catch {
		return null;
	}
}

function parseISO(s: string | undefined): number | null {
	if (!s) return null;
	const t = Date.parse(s);
	return Number.isNaN(t) ? null : t;
}

/**
 * Pure, in-process filter+sort+paginate over a Run array. Used by both
 * MemoryStore (in-memory map) and JsonFileStore (per-call directory scan)
 * to share filter/sort/cursor logic. SQL backends compute these in the DB
 * and do not use this helper.
 */
export function listRunsInProcess(
	allRuns: Run[],
	filters: RunListFilters,
): RunListResult {
	const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
	const rootsOnly = filters.rootsOnly ?? true;
	const startedAfter = parseISO(filters.startedAfter);
	const startedBefore = parseISO(filters.startedBefore);
	const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;

	const filtered = allRuns.filter((r) => {
		if (rootsOnly && r.parentId) return false;
		if (filters.agentId && r.agentId !== filters.agentId) return false;
		if (filters.status && r.status !== filters.status) return false;
		if (startedAfter !== null && r.startedAt < startedAfter) return false;
		if (startedBefore !== null && r.startedAt > startedBefore) return false;
		if (cursor) {
			// Strict less-than on (startedAt, id) — only rows that come AFTER the cursor.
			if (r.startedAt > cursor.startedAt) return false;
			if (r.startedAt === cursor.startedAt && r.id >= cursor.id) return false;
		}
		return true;
	});

	filtered.sort((a, b) => {
		if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt;
		return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
	});

	const page = filtered.slice(0, limit);
	const hasMore = filtered.length > limit;
	return {
		rows: page,
		cursor: hasMore
			? encodeCursor({
					startedAt: page[page.length - 1].startedAt,
					id: page[page.length - 1].id,
				})
			: undefined,
	};
}
