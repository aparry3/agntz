import type { Span, TraceSummary } from "../../types.js";

/**
 * Build a Span with sensible defaults. Override anything that matters to the
 * test. Used by the conformance suite and by later slices' tests.
 *
 * Tests running in parallel against a shared backend should always provide
 * an explicit `traceId` / `spanId` / `ownerId` — the random defaults give
 * only ~41 bits of entropy and are intended for single-process suites.
 */
export function makeSpan(overrides: Partial<Span> = {}): Span {
	const spanId =
		overrides.spanId ?? `sp_${Math.random().toString(36).slice(2, 10)}`;
	return {
		spanId,
		traceId:
			overrides.traceId ?? `tr_${Math.random().toString(36).slice(2, 10)}`,
		parentId: overrides.parentId ?? null,
		ownerId: overrides.ownerId ?? "user_test",
		runId: overrides.runId ?? null,
		sessionId: overrides.sessionId ?? null,
		name: overrides.name ?? "agent.invoke",
		kind: overrides.kind ?? "invoke",
		startedAt: overrides.startedAt ?? "2026-05-11T08:00:00.000Z",
		endedAt: overrides.endedAt ?? null,
		durationMs: overrides.durationMs ?? null,
		status: overrides.status ?? "running",
		error: overrides.error ?? null,
		attributes: overrides.attributes ?? {},
		events: overrides.events ?? [],
		scores: overrides.scores ?? {},
		costUsd: overrides.costUsd ?? null,
	};
}

/**
 * Build a TraceSummary with sensible defaults. Same collision caveats as
 * `makeSpan` — provide explicit IDs in parallel/shared-backend tests.
 */
export function makeSummary(
	overrides: Partial<TraceSummary> = {},
): TraceSummary {
	return {
		traceId:
			overrides.traceId ?? `tr_${Math.random().toString(36).slice(2, 10)}`,
		ownerId: overrides.ownerId ?? "user_test",
		rootName: overrides.rootName ?? "agent.invoke",
		agentId: overrides.agentId ?? null,
		startedAt: overrides.startedAt ?? "2026-05-11T08:00:00.000Z",
		endedAt: overrides.endedAt ?? null,
		durationMs: overrides.durationMs ?? null,
		spanCount: overrides.spanCount ?? 1,
		status: overrides.status ?? "running",
		totalTokens: overrides.totalTokens ?? 0,
		totalCostUsd: overrides.totalCostUsd ?? null,
	};
}

/**
 * A complete, three-span trace fixture: run → invoke → model.call. Used by
 * tests that need a realistic shape, not just a single span.
 */
export function makeThreeSpanTrace(opts: {
	traceId: string;
	ownerId: string;
	agentId?: string;
}): Span[] {
	const { traceId, ownerId, agentId = "agent-x" } = opts;
	return [
		makeSpan({
			spanId: `${traceId}_root`,
			traceId,
			ownerId,
			parentId: null,
			name: "agent.run",
			kind: "run",
			status: "ok",
			startedAt: "2026-05-11T08:00:00.000Z",
			endedAt: "2026-05-11T08:00:02.000Z",
			durationMs: 2000,
			attributes: { "agent.id": agentId },
		}),
		makeSpan({
			spanId: `${traceId}_invoke`,
			traceId,
			ownerId,
			parentId: `${traceId}_root`,
			name: "agent.invoke",
			kind: "invoke",
			status: "ok",
			startedAt: "2026-05-11T08:00:00.100Z",
			endedAt: "2026-05-11T08:00:01.900Z",
			durationMs: 1800,
			attributes: { "agent.id": agentId, model: "claude-sonnet-4-6" },
		}),
		makeSpan({
			spanId: `${traceId}_model`,
			traceId,
			ownerId,
			parentId: `${traceId}_invoke`,
			name: "agent.model.call",
			kind: "model",
			status: "ok",
			startedAt: "2026-05-11T08:00:00.200Z",
			endedAt: "2026-05-11T08:00:01.500Z",
			durationMs: 1300,
			attributes: { "agent.step": 1, model: "claude-sonnet-4-6" },
			costUsd: 0.0042,
		}),
	];
}
