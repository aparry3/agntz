/**
 * The agent-reference parser is a pure leaf utility shared across packages, so
 * it now lives in `@agntz/contracts`. Re-exported here so core's internal
 * `./agent-ref.js` importers and `@agntz/core`'s public surface are unchanged.
 */
export {
	formatAgentRef,
	isAliasName,
	isIsoTimestamp,
	parseAgentRef,
} from "@agntz/contracts";
export type { ParsedAgentRef } from "@agntz/contracts";
