# Provider harness

The provider harness separates deterministic harness tests from credentialed
calls to hosted model providers.

## Deterministic tests

Run these in normal CI. They do not read provider credentials or make network
calls.

```sh
pnpm --filter @agntz/provider-harness test
```

## Live smoke suite

The smoke suite selects one representative current model per configured
provider and runs text, tool-roundtrip, and structured-output cases against
both the TypeScript and Python SDKs. It covers OpenAI, Anthropic, Google,
Mistral, xAI, Groq, DeepSeek, Perplexity, Cohere, and OpenRouter. Azure is not
in the shared matrix because its request model is a deployment name chosen by
the account owner rather than a portable model id.

```sh
pnpm test:providers:smoke
```

At least one supported provider key must be present. Providers without a key
are skipped. A configured key that is rejected is a test failure.

## Live compatibility suite

The compatibility suite exercises the complete model and capability matrix.
Run it manually when changing provider adapters or capability declarations.

```sh
pnpm test:providers:compat
```

Both live suites write timestamped JSON, Markdown, and JUnit reports under
`apps/provider-harness/reports/`. GitHub runs the smoke suite weekly and allows
either suite to be selected manually. Live provider results are diagnostic and
are not release or pull-request gates.
