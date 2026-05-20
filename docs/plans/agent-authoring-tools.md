# Agent Authoring Tools: MCP + CLI

**Status:** Proposed
**Author:** Aaron + Claude
**Date:** 2026-05-18

## Problem

Today, creating an agntz agent requires opening the web UI, writing a manifest in the editor, and saving. That's fine for first-time use, but when you're already in a coding tool (Claude Code, Codex, Cursor) building a service like GymText and want to add an agent, the context switch is friction. The goal is to let a developer — or the AI coding tool itself — author and manage agents without leaving the terminal.

This document plans two new surfaces over the existing agntz API:

1. A hosted **MCP server** at `apiagntz.co/mcp` so any MCP-aware tool (Claude Code, Codex, Cursor, Zed, etc.) can manage agents.
2. A **CLI** (`agntz` binary, extended) for terminal/TUI workflows and scripts.

Both wrap a new authoring SDK and route through a server-side **agent-builder agent** that turns natural-language descriptions into validated manifests.

## Decisions snapshot

| Choice | Decision |
|---|---|
| Primary entry point | `build_agent` (NL → agent-builder agent) |
| Build → save | Always two-step; review between |
| Auth surface | Per-user API key (bearer token) |
| Auth login flow | Device-code via web UI (`agntz auth login`) |
| Builder output | `{yaml, summary, warnings, recommended_model, suggested_tests}` |
| API surface | Builder path + raw CRUD both exposed |
| Hosted MCP location | `<host>/mcp` route group in `packages/app` |
| CLI binary | Extend existing `agntz`, lazy-load SDKs |
| SDK split | `@agntz/sdk` stays runtime; new `@agntz/management` for authoring |
| Self-hosting | Host configurable everywhere; auth-provider-agnostic |
| Skill | Heavy guidance, focused on describing agents well |
| Agent-builder | A first-class agntz agent, model-portable |

## Architecture

```
       User in Claude Code / Codex / Cursor / TUI
                          │
                          │ "make an agent that summarizes Slack threads"
                          ▼
       Local model (CC / Codex / etc.) or `agntz` CLI
                          │
                          │  build_agent(description, hints?)
                          ▼
       <host>/mcp  (hosted MCP server, Streamable HTTP)
       or @agntz/management (CLI / scripts)
                          │
                          │  invokes server-side "agent-builder" agent
                          ▼
       agent-builder  ← a real, versioned agntz agent
       - list_skills, list_mcp_servers, list_secrets
       - manifest schema in its system prompt
       - structured output: {yaml, summary, warnings, ...}
                          │
                          │  returns draft YAML
                          ▼
       Local model shows draft to user, accepts tweaks
                          │
                          │  save_agent(yaml)
                          ▼
                  persisted (versioned, aliased)
```

### Key principle: agent-builder lives server-side

Improving how agntz authors agents = improving one prompt + eval set on the server. No client updates, no skill-file drift, consistent quality across every coding tool. The local model's job is the easy part (capture intent, review draft, confirm); the hard part (writing a valid manifest given the deployment's available skills/MCP servers/secrets) happens server-side with full context.

## Package layout

```
packages/
├─ app/                                    ← Next.js app
│  └─ src/app/api/
│     ├─ agents/                           ← (existing) REST routes
│     │  └─ build/route.ts                 ← (NEW) POST /api/agents/build
│     ├─ cli-auth/                         ← (NEW) device-code endpoints
│     │  ├─ init/route.ts
│     │  ├─ poll/route.ts
│     │  └─ confirm/page.tsx               ← user-facing approve/deny
│     └─ mcp/                              ← (NEW) hosted MCP server
│        └─ route.ts                       ← Streamable HTTP transport
├─ core/
│  └─ src/cli.ts                           ← (EXTEND) add `auth`, `agents`, `traces`
├─ sdk/                                    ← (UNCHANGED in shape) @agntz/sdk
│  └─ AgntzClient — runtime: agents.run/.stream, runs.*, traces (read)
├─ management/                             ← (NEW) @agntz/management
│  └─ AgntzManagementClient
│     ├─ agents.build / .create / .update / .validate / .delete
│     ├─ agents.list / .get / .versions / .setAlias / ...
│     ├─ skills.list, secrets.list, mcpServers.list
│     └─ traces.list / .get
└─ ...
```

**Why split SDK from management:**
- Different audiences: prod app embedding agntz wants small/stable runtime; authoring tools want rich CRUD.
- Tree-shaking helps but isn't honest — clean package boundaries are clearer than relying on bundlers.
- Independent versioning: management API will churn faster than `run`/`stream`.
- Precedent: Vercel and similar platform-with-runtime products split this way.

**Why hosted MCP lives inside `packages/app`:**
- Same-process access to store + runner + worker validator — no HTTP roundtrip.
- Reuses existing auth middleware.
- DNS just routes `apiagntz.co/mcp` (or self-host equivalent) to the same Next.js app.
- Streamable HTTP transport is stateless-ish; works fine in serverless.

## Self-hosting model

The CLI and MCP server are agnostic to which agntz instance they talk to. They speak HTTP + bearer tokens — that's it. Self-hosters control everything else (host, auth provider, LLM provider).

### Configurable per environment

| Surface | Hosted default | Self-host override |
|---|---|---|
| API host | `https://apiagntz.co` | `https://agntz.theircompany.com` |
| MCP URL | `https://apiagntz.co/mcp` | `https://agntz.theircompany.com/mcp` |
| Auth provider | Clerk | Their choice (Clerk, Auth.js, Okta, GitHub OAuth, static admin) |
| Login confirm page | Hosted at our UI | Hosted at their UI (auto via path) |
| LLM provider for builder | Anthropic (our key) | Theirs (Anthropic / Bedrock / Ollama / ...) |

### Why this works

The CLI and MCP server only deal in **bearer tokens**. They don't care how the token was obtained. The auth-provider abstraction lives entirely server-side, behind the `requireUserContext()` helper. Whether the user logged in via Clerk or Okta, the resulting `Authorization: Bearer <token>` looks identical to the client.

The device-code flow inherits this: the confirm page is just a thin "approve this code" view gated by `requireSession()`, which works for any auth provider that returns a `userId`.

### CLI config model (`gh`-style, multi-profile)

```
~/.config/agntz/config.json
{
  "profiles": {
    "default":       { "host": "https://apiagntz.co",           "token": "..." },
    "gymtext-prod":  { "host": "https://agntz.gymtext.internal","token": "..." }
  },
  "current": "default"
}
```

**Resolution order** (first match wins):
1. `--host` / `--profile` flag
2. `AGNTZ_HOST` / `AGNTZ_API_KEY` env vars
3. `.agntz/config.json` in cwd or ancestor (repo-local, no secrets — just host)
4. `~/.config/agntz/config.json` (user-global, holds tokens)
5. Built-in default: `apiagntz.co`

**Commands:**
- `agntz auth login [--host <url>]` — opens device-code flow, creates a profile
- `agntz config use <profile>` / `agntz config list` / `agntz config set host=...`
- A repo-local `.agntz/config.json` lets teammates clone, run `agntz auth login`, and be ready

### MCP registration (no magic)

```
Hosted:
  claude mcp add agntz https://apiagntz.co/mcp --header "Authorization: Bearer XXX"

Self-host:
  claude mcp add agntz https://agntz.theircompany.com/mcp --header "Authorization: Bearer XXX"
```

The user is already setting up the connection; making them name the host explicitly is expected.

## Phased implementation plan

### Phase 0 — Author the agent-builder agent

Lives in the manifest registry as a "system" agent (not user-owned). The first dogfood test of the platform: agntz authoring agntz.

- System prompt with the manifest schema embedded
- Tools available: `list_skills`, `list_mcp_servers`, `list_secrets`, internal `validate_manifest`
- Structured output schema enforced: `{yaml: string, summary: string, warnings: string[], recommended_model: string, suggested_tests: string[]}`
- Seed eval set: 10–20 description→expected-manifest-properties pairs covering:
  - Basic LLM agent
  - Agent that uses MCP tools
  - Sub-agent spawner
  - Eval-driven agent
  - Agent with a reply tool
- **Model portability**: eval against 2–3 providers (Anthropic, OpenAI, an open-source frontier model) so self-hosters with different LLM providers get usable output

**Acceptance:** the agent-builder produces a valid manifest for every seed description, on every supported provider.

### Phase 1 — `@agntz/management` SDK

New package. HTTP client over the agntz REST API, bearer-token auth.

**`AgentsResource`:**
- `.build(description, hints?)` → `{yaml, summary, warnings, recommended_model, suggested_tests}`
- `.create(yaml)` → `{id, version_ts, yaml, url, summary}`
- `.update(id, yaml)` → same shape, new version_ts
- `.validate(yaml)` → `{ok, errors, warnings}`
- `.delete(id)`
- `.list()`, `.get(id, version?)`
- `.versions(id)`, `.setAlias(id, alias, ts)`, `.removeAlias(id, alias)`, `.activateVersion(id, ts)`

**Read-only resources:**
- `SkillsResource.list()`
- `SecretsResource.list()` (names only, no values)
- `McpServersResource.list()`

**Traces:**
- `TracesResource.list(filter)`, `.get(id)` — for debugging runs

Shared internals (HTTP, retry, auth, errors) factored into a private module. If duplication with `@agntz/sdk` becomes painful, extract `@agntz/sdk-core` later.

**Acceptance:** end-to-end `curl`-equivalent tests passing against a local agntz instance.

### Phase 2 — API-key auth + device-code login

**Server:**
- Extend `requireUserContext()` to accept `Authorization: Bearer <key>` as an alternative to a Clerk session. Look up key → userId via the existing `ApiKeyStore`. Scope the store the same way.
- New endpoints (auth-provider-agnostic):
  - `POST /cli-auth/init` → `{code, verification_url, poll_url, expires_in}`
  - `POST /cli-auth/poll` → polled by CLI; returns `pending` or `{token}` once approved
  - `GET /cli-auth/confirm?code=XXX` → renders approve/deny page, gated by `requireSession()` (whatever auth the deployment uses)
- UI: "API keys" section in user settings for manual key management (generate, label, revoke, view last-used)

**CLI:**
- `agntz auth login [--host <url>]`:
  1. POST `/cli-auth/init` with the configured host
  2. Print code + open `verification_url` in browser (fallback: print URL to copy)
  3. Poll `/cli-auth/poll` until approved or timeout
  4. Write `{host, token}` into `~/.config/agntz/config.json` under a profile name
- `agntz auth status` — show current profile, host, token expiry
- `agntz auth logout [--profile <name>]`

**Acceptance:** `agntz auth login` works against a fresh local agntz instance; resulting token authenticates a subsequent `agntz agents list`.

### Phase 3 — `POST /api/agents/build`

Thin endpoint that accepts `{description, hints?}`, invokes the agent-builder agent via the existing invoke pipeline (server-side, scoped to caller's user), returns the structured output. Reuses the runner — no new infrastructure.

**Acceptance:** `curl -X POST <host>/api/agents/build -d '{"description": "..."}'` returns a valid YAML + summary.

### Phase 4 — Hosted MCP server

New route group `packages/app/src/app/api/mcp/route.ts` using `@modelcontextprotocol/sdk` Streamable HTTP transport.

**Authoring tools:**
- `build_agent(description, hints?)` — calls the agent-builder, returns draft YAML
- `save_agent(yaml)` — validates + persists
- `update_agent(id, yaml)`
- `validate_manifest(yaml)`

**Reading tools:**
- `list_agents()`, `get_agent(id, version?)`
- `list_skills()`, `list_mcp_servers()`, `list_secrets()` — names only

**Running tools:**
- `invoke_agent(id, input, session_id?)` — so the local model can smoke-test what it just made
- `list_traces(filter?)`, `get_trace(id)` — so the local model can debug a bad run

**Versioning tools:**
- `list_versions(id)`, `set_alias(id, alias, ts)`, `remove_alias(id, alias)`, `activate_version(id, ts)`

Auth: bearer token on the initial MCP handshake, scoped store per session. Same `requireUserContext()` path as REST.

**Acceptance:** `claude mcp add agntz <url> --header "Authorization: Bearer XXX"`, then from inside Claude Code invoking `build_agent` returns a draft YAML that `save_agent` persists.

### Phase 5 — CLI subcommands

Extend `packages/core/src/cli.ts` with new namespaces. Lazy-load `@agntz/management` so local-only users (`init`, `playground`, `eval`) don't pay the cost.

```
agntz auth login | status | logout [--host <url>] [--profile <name>]
agntz config use <profile> | list | set <key=value>

agntz agents build <description>          # prints draft, prompts Y/n save
agntz agents create [file.yaml]           # stdin if no file
agntz agents update <id> [file.yaml]
agntz agents list
agntz agents get <id> [--version <ts>]
agntz agents invoke <id> -i "input"
agntz agents delete <id>

agntz versions <id>
agntz alias <id> <alias> <ts>
agntz alias rm <id> <alias>

agntz traces list <agentId>
agntz traces get <traceId>
```

Global flags: `--host`, `--profile`, `--json` (machine-readable output).

**Acceptance:** every command works against the hosted instance and against a self-hosted instance with a different `--host`.

### Phase 6 — Claude Code skill

A markdown skill that teaches the local model when and how to use the agntz MCP tools. Lives in this repo for now (could be published separately later).

**Contents:**
- When to reach for this skill (user is asking to author/modify/test agntz agents)
- The two-step pattern: `build_agent` → review with user → `save_agent` → `invoke_agent` smoke test
- 3–4 worked descriptions showing good vs. bad inputs:
  - Good: "agent that reads GitHub PR comments and drafts replies in my voice, using the linear MCP for context, returns a single suggested reply"
  - Bad: "make an agent for GitHub"
- Pre-call checklist for the model:
  - Intended inputs and outputs?
  - Tools/skills/MCP servers needed? (call `list_skills` / `list_mcp_servers` first if unsure)
  - Model preference?
  - Eval criteria?
  - Sub-agents to spawn?
- What to do with `warnings` from the builder
- How to interpret `suggested_tests` and turn them into eval cases

Portable enough to be repurposed as a Codex / Cursor system-prompt include later.

### Future / out of scope

- **Phase 7 — `npx @agntz/mcp-server` (stdio):** wrap the management SDK as a local-stdio MCP for users who can't or won't use remote MCP. ~30 lines once Phase 1 ships.
- **Phase 8 — Progress streaming for `invoke_agent`:** MCP progress notifications so the caller sees streaming output as the agent runs.
- **Phase 9 — Slack / GitHub Action / Linear surfaces:** all thin wrappers over the same `@agntz/management` client.
- **Eval-driven authoring:** `build_agent` could optionally generate the eval set and run it as a smoke test before returning. Promising but adds significant latency.

## Risks & open questions

- **Agent-builder eval debt.** The builder is only as good as its eval set. Phase 0 must include real test cases or quality drifts as we iterate. Budget time for this, not just prompt-tuning.
- **Streamable HTTP in Next.js / Vercel.** Need a spike before committing Phase 4. The MCP SDK's HTTP transport is newer and may have edge cases with App Router / edge runtime. Fallback: dedicated Node service on Railway under the same domain.
- **Manifest validator coupling.** Today validation runs through the worker. The agent-builder probably wants to call it inline server-side. Decide whether to extract validator into a shared package or have the builder hit the worker.
- **Rate limiting / cost.** A new MCP tool that runs an LLM-powered agent server-side is a real cost vector. Want per-user / per-day quotas on `build_agent` from day one, especially for the hosted product.
- **Provider portability of the builder.** Capability differences between providers (structured output reliability, tool-calling quality) may force provider-specific prompt variants. Worth knowing early.
- **Self-host bootstrap.** A fresh self-hosted instance has no API keys. Need either a seed script (`agntz-admin create-key`), an env-var-driven admin token, or a first-run UI flow.
- **Token storage on shared dev machines.** `~/.config/agntz/config.json` stores tokens in plaintext. Acceptable for v1 (matches `gh`/`gcloud`), but document the choice and offer keychain integration later.

## Suggested first slice

**Phases 1 + 2 together** — build `@agntz/management` + API-key auth + device-code login. Self-contained, ~1–2 days, end-to-end testable with `curl` and a hand-rolled script before any UI or MCP work. Everything downstream (MCP, CLI, skill) depends on these.

After that, Phase 0 (agent-builder agent) and Phase 3 (build endpoint) can ship together as the second slice. Phase 4 (MCP) and Phase 5 (CLI) parallelize cleanly once Phase 1 is in place.
