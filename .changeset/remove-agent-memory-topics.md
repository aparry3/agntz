---
"@agntz/memrez": patch
---

Remove agent-level memory topic taxonomy config from the memrez resource provider. Agent manifests now own preload/read/write behavior only; topic taxonomy and reasoner policy are reserved for Memrez-level configuration.
