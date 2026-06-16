/**
 * The outbound-URL policy (SSRF guard + hardened fetch) now lives in the shared
 * kernel `@agntz/contracts`. This module re-exports it from the original path so
 * core's internal importers and `@agntz/core`'s public surface stay unchanged.
 */
export {
	OutboundUrlPolicyError,
	assertOutboundUrlAllowed,
	fetchWithOutboundPolicy,
	validateOutboundUrl,
} from "@agntz/contracts";
export type {
	FetchWithOutboundPolicyOptions,
	OutboundUrlPolicyOptions,
} from "@agntz/contracts";
