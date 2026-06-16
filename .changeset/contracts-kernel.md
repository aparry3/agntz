---
"@agntz/contracts": minor
"@agntz/core": patch
"@agntz/manifest": patch
---

Introduce `@agntz/contracts`, the shared-vocabulary kernel.

- **@agntz/contracts** (new): a zero-runtime-dependency package for vocabulary and pure leaf utilities shared by `@agntz/core` and `@agntz/manifest`. It seeds with the outbound-URL policy (the SSRF guard + hardened redirect-following fetch: `validateOutboundUrl`, `assertOutboundUrlAllowed`, `fetchWithOutboundPolicy`, `OutboundUrlPolicyOptions`, `OutboundUrlPolicyError`).
- **@agntz/core**: the outbound-URL policy now lives in `@agntz/contracts`; core re-exports it from the original module path, so core's public surface and internal imports are unchanged.
- **@agntz/manifest**: imports the outbound-URL policy from `@agntz/contracts` instead of `@agntz/core`, removing that part of its dependency on core.
