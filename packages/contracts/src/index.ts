/**
 * `@agntz/contracts` — the shared-vocabulary kernel.
 *
 * Zero-runtime-dependency types and pure leaf utilities that more than one
 * agntz package needs (`@agntz/core`, `@agntz/manifest`, the worker). Both core
 * and manifest depend on this kernel; neither has to depend on the other for
 * the vocabulary it holds.
 *
 * Today it owns the outbound-URL policy (SSRF guard + hardened fetch). Other
 * shared vocabulary (HTTP-tool / auth config, agent-ref parsing) will migrate
 * here incrementally — see the library/application separation plan.
 */
export * from "./outbound-url.js";
