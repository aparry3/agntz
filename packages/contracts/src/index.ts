/**
 * `@agntz/contracts` — the shared-vocabulary kernel.
 *
 * Zero-runtime-dependency types and pure leaf utilities that more than one
 * agntz package needs (`@agntz/core`, `@agntz/manifest`, the worker). Both core
 * and manifest depend on this kernel; neither has to depend on the other for
 * the vocabulary it holds.
 *
 * It owns the outbound-URL policy (SSRF guard + hardened fetch), the agent-ref
 * parser, the base error vocabulary, and the declarative HTTP-tool / auth /
 * skill vocabulary shared by core (which resolves it at runtime) and manifest
 * (which parses it from YAML).
 */
export * from "./agent-ref.js";
export * from "./errors.js";
export * from "./http-auth.js";
export * from "./http-tool.js";
export * from "./outbound-url.js";
export * from "./span.js";
export * from "./tools.js";
