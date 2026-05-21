# agntz Landing Page — Design + Copy Spec

Working document for the marketing landing page. Every code snippet matches the real `@agntz/client` and `@agntz/manifest` schemas as of 2026-05-17. Sections marked **Requires Path A** depend on product work outlined at the bottom — flag these to engineering before the page goes live.

---

## Audience & Positioning

**Primary buyer:** A platform / AI engineer at a Series A–C company that already has a product and is adding AI features. They've shipped one or two LLM calls, the code is getting messy, and they're staring at LangChain / Mastra / Vercel AI SDK trying to decide what scales.

**Not the buyer:** A from-scratch AI-native startup founder. They'll pick the OpenAI Agents SDK or roll their own, and they care about model access, not framework choice.

**The wedge:** You already have an LLM call in your app and it's getting messy. agntz is the next step up — not a from-scratch framework.

**The three differentiators we sell on:**
1. **Observability built in** — every run traced down to the token, included not extra.
2. **Versioning + pinning** — every save is a version, prod runs the pinned one, rollback in a click.
3. **Open-source + portable** — same framework self-hosted or hosted; no lock-in.

---

## Voice & Tone

- Staccato over flowing. Short sentences. Contrast pairs (*"Save creates a version. Pin chooses what ships."*).
- Verbs before nouns. *"Iterate live"* over *"Live iteration."*
- No empty hype words: skip "supercharge", "unleash", "revolutionize", "AI-powered" (when describing agntz itself).
- Concrete numbers and identifiers in code. `claude-sonnet-4-6`, `support-agent`, real package names.
- The reader is a senior engineer. Talk to them like one.

---

## Narrative Arc

Each section advances a single thesis: **config + versioning + observability + portability = agents you can trust in production.**

1. **Hero** — names the promise.
2. **Pillars** — four claims that prove it.
3. **How it works** — proves pillar #1 (config, not code) is real.
4. **Observability spotlight** — proves you can see what your agents do.
5. **Versioning spotlight** — proves you can change agents safely.
6. **Composition spotlight** — proves the model scales to real workloads.
7. **Who it's for** — matches the reader to a path.
8. **Self-host vs hosted** — closes the operational-choice question.
9. **Pricing teaser** — closes the commercial-choice question.
10. **Integrations strip** — proves you fit their stack.
11. **Bottom CTA** — singular action.
12. **Footer** — standard.

---

## Section 1 — Hero

**Purpose:** State the promise in one breath. Hand devs a code snippet that proves it.

### Copy

**H1 (pick one — top is recommended):**
1. Ship AI in your product. See every step it takes.
2. From prompt to production, before lunch.
3. Agents your team can ship, change, and trust.

**Subhead:**
> Open-source agents you define once, version automatically, and run anywhere. Traces, evals, and debugging built in.

**Subhead alt (if fewer claims read cleaner):**
> The open-source agent framework with versioning and observability built in.

**CTAs:** `[ Get started ]`   `[ View on GitHub ]`

### Hero code snippet

```ts
import { AgntzClient } from '@agntz/client';

const agntz = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: 'https://api.agntz.co',
});

// Production always runs the pinned version
const { output } = await agntz.agents.run({
  agentId: 'support-agent',
  input: { message: email.body, customerId: email.from },
});
```

### Notes

- Real package name: `@agntz/client`. Real class: `AgntzClient`. Real method: `client.agents.run({ agentId, input })`. Don't simplify away from these.
- Comment in the snippet ("Production always runs the pinned version") seeds the versioning story we expand on later.

---

## Section 2 — Four Pillars

**Purpose:** Land the four claims the rest of the page proves.

### Copy

**1. Agents as config, not code.**
Iterate in seconds. Deploy with confidence. No framework to learn. Define behavior as configuration; call it from any service with one line.

**2. Iterate live. Pin what ships.**
Every save is a new version, stamped with the moment you saved it. `support-agent` always resolves to the pinned version in production. `support-agent@latest` runs your newest save. `support-agent@2026-05-17T15:42` runs any specific point in time. Alias the ones you care about — `@canary`, `@known-good`, whatever fits. Nothing reaches users until you pin it. **Requires Path A.**

**3. Eval and debug in one place.**
Every run, every span, every token — traced, replayable, scorable. Jump from any trace straight to the agent version that produced it. The observability layer ships with the framework, not as a separate $400/month tool.

**4. Run it anywhere.**
Docker, Kubernetes, your cloud, our cloud, your laptop. Bring your own Postgres or SQLite. Self-host the whole stack, or let us run it when you're ready to stop.

### Notes

- Pillar order matters: principle → safety → visibility → trust. Don't reorder casually.
- Pillar #2 is the longest because it's your differentiator. Earn the air.
- "$400/month tool" in pillar #3 — swap for the real Langfuse/Helicone starting price if you want precision.

---

## Section 3 — How It Works

**Purpose:** Prove pillar #1 is real with concrete code.

### Copy

> Define. Call. Iterate. Three steps from idea to production.

### Step 1 — Define your agent

Author in YAML, the UI, or via SDK — every save creates a new version in your store.

```yaml
id: support-agent
name: Support Triager
description: Triage support emails and draft a reply
kind: llm

inputSchema:
  message: string
  customerId: string

model:
  provider: anthropic
  name: claude-sonnet-4-6

instruction: |
  You are a senior support agent. Read the customer's message, look up
  their history, and draft a friendly, accurate reply.

  Message:
  {{message}}

tools:
  - kind: local
    tools: [lookup_customer, search_kb]
```

### Step 2 — Call it from your code

One call from any service, edge function, or worker. The runtime resolves the active version from your store.

```ts
import { AgntzClient } from '@agntz/client';

const agntz = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: 'https://api.agntz.co',
});

const { output } = await agntz.agents.run({
  agentId: 'support-agent',
  input: { message: email.body, customerId: email.from },
});
```

### Step 3 — Observe, iterate, pin

Every run is traced end-to-end — prompt, model output, every tool result, and the exact version that produced it. Edit, save, test against `@latest`, pin when you're ready.

```ts
// Test the newest save before promoting it
await agntz.agents.run({
  agentId: 'support-agent@latest',
  input: { message },
});
```
**Requires Path A.**

`[ View a live trace → ]`

### Notes

- The YAML matches `examples/agents/with-tools.yaml` field-for-field. Use the real schema.
- The streaming variant (`agntz.agents.stream(...)`) can show up later — don't crowd the main flow.
- `agentId: 'support-agent@latest'` is the syntax we're committing to in Path A. Verify with engineering before publishing.

---

## Section 4 — Observability Spotlight

**Purpose:** Show the trace UI. This is your moat — give it air.

### Copy

**H2:** Every step, every token, every version — traced.

**Body:**
> See the prompt. See the response. See every tool call. See the version that ran it. Built in, not bolted on.
>
> Every run captures the full execution graph — spans for model calls, tool calls, and child agents. Replay any trace. Compare runs. Score outputs against evals. No OpenTelemetry duct tape, no second vendor.

**Inline link:** *Jump from any trace to the agent version that produced it. →*

### Visual

- **Primary:** Wide annotated screenshot of the trace detail panel (`packages/app/src/...trace-detail`). Annotations point at: the span tree, the prompt panel, the tool call result, the version pin indicator.
- **Stretch:** 5–10 second screen recording of click trace → expand span → jump to version. This sells the section 10× harder than static.

### Notes

- "Score outputs against evals" — verify the evals product is real or roadmapped before shipping this line. If not, replace with "Replay them to debug regressions."
- The "jump from trace to version" link is the Path A integration that ties observability and versioning together; it's the strongest cross-feature story we have.

---

## Section 5 — Versioning Spotlight

**Purpose:** Sell the pinned-by-default + addressable-versions model. **Requires Path A.**

### Copy

**H2:** Iterate without fear.

**Body:**
> Save creates a version. Pin chooses what ships.
>
> Every save is timestamped, immutable, and addressable. Production calls `support-agent` and gets the pinned version — your in-flight edits never reach users until you pin them. Test against `support-agent@latest`. Roll back to any prior version in one click. Compare two versions side-by-side to see what changed.
>
> This is the difference between *prompt engineering* and *prompt operations.*

### Visual

Two-pane mockup:
- **Left:** the agent editor (YAML or form view), unsaved changes indicated.
- **Right:** the version history panel — a list of timestamps with the pinned one highlighted, a `[ Pin this version ]` button on a non-pinned row, and one keyword alias visible (e.g., `@known-good → 2026-05-15T09:12`).

### Notes

- The closing line ("difference between prompt engineering and prompt operations") is the kicker — positions the feature as a category leap, not a checkbox.
- Side-by-side diff view in the UI is a real product dep — see Path A.

---

## Section 6 — Composition Spotlight (recommended)

**Purpose:** Prove the model scales beyond a single LLM call.

### Copy

**H2:** From one agent to many.

**Body:**
> Agents compose. A `sequential` agent runs steps in order and passes state forward. A `parallel` agent runs branches concurrently and joins their results. Loop with `until` conditions. Compose tool calls, MCP servers, and other agents the same way.
>
> No new framework to learn. The same YAML, the same runtime, the same observability — whether your agent is one model call or twelve.

### Visual

Two-column side-by-side:
- **Left:** A trimmed snippet of `examples/agents/article-pipeline.yaml` showing `kind: sequential` with parallel research + write/review loop.
- **Right:** A screenshot of the resulting trace — parallel branches visible, sequential steps below.

### Code snippet (trimmed for marketing)

```yaml
id: article-pipeline
kind: sequential

steps:
  - agent:
      id: research
      kind: parallel
      branches:
        - agent: { id: web-researcher, kind: llm, ... }
        - agent: { id: academic-researcher, kind: llm, ... }

  - agent:
      id: write-review
      kind: sequential
      until: '{{editor.approved}} == true'
      maxIterations: 3
      steps:
        - agent: { id: writer, kind: llm, ... }
        - agent: { id: editor, kind: llm, ... }
```

### Notes

- Real fields from `article-pipeline.yaml`. Don't invent new keywords.
- Skip this section if the page feels too long — but the composition story is hard to tell anywhere else and it differentiates from "single-call SDK" tools like Vercel AI SDK.

---

## Section 7 — Who It's For

**Purpose:** Match the reader to a path. Drives intent into specific docs.

### Three cards

**Card 1 — Adding AI to an existing product**
> You have a real app. You want to add agents without rewriting everything around them. Drop in one SDK call. Configure agents in YAML or the UI. Ship features without a framework migration.
>
> *[ Read the 5-minute quickstart → ]*

**Card 2 — Outgrowing LangChain or agent spaghetti**
> Your agent code is unmaintainable. Tools and prompts are scattered across files. Debugging means console.log archaeology. Bring it into one declarative manifest with first-class traces.
>
> *[ See the migration guide → ]*

**Card 3 — Need observability your framework doesn't ship**
> You're already paying for Langfuse, Helicone, or Arize. Or you've duct-taped together OpenTelemetry. Get every span, every token, every version — included, not extra.
>
> *[ See a live trace → ]*

### Notes

- Each card targets a different incumbent / pain. If you only have one quickstart page, all three CTAs can link to it for now.
- Card 2 is most likely to convert paid traffic — refactor pain is acute and budgeted.

---

## Section 8 — Self-Host vs Hosted

**Purpose:** Close the "where does this run?" question.

### Copy

**H2:** Run it your way.

**Subhead:** Both editions ship with the same features. The difference is operational burden.

### Comparison table

|  | **Self-Hosted (OSS)** | **Hosted (agntz.co)** |
|---|---|---|
| **License** | MIT, free forever | Free tier + paid plans |
| **Runtime** | Your infrastructure | Managed by us |
| **Database** | Your Postgres or SQLite | Managed Postgres |
| **Traces & observability** | ✓ Full | ✓ Full |
| **Versioning & pinning** | ✓ Full | ✓ Full |
| **Multi-tenancy / per-user scoping** | ✓ | ✓ Plus orgs, SSO, RBAC |
| **Setup time** | Docker compose, ~5 min | Sign up, ~30 sec |
| **Scaling & uptime** | You handle it | Auto-scaled, monitored |
| **SLA** | None | Available on paid tiers |

### Notes

- **Do not gate observability or versioning behind the hosted edition.** These are the differentiators that drive OSS adoption. The hosted column sells *operational relief*, not *feature unlock*.
- The "✓" pattern on both columns visually reinforces parity. Differences should look like *additions* on the hosted side (orgs, SSO, SLA), not *subtractions* on the OSS side.

---

## Section 9 — Pricing Teaser

**Purpose:** Devs won't commit without seeing a number.

### Copy options

**Minimal (if pricing isn't finalized):**
> Free forever, self-hosted. Hosted plans start at $X/month. Custom for teams.
>
> *[ See pricing → ]*

**Slightly more committed (3 tiers):**

| | **OSS** | **Hosted Starter** | **Hosted Team** |
|---|---|---|---|
| Price | Free | $X/mo | Custom |
| Runs/mo | Unlimited (your infra) | 100k | Custom |
| Seats | Unlimited | 5 | Custom |
| Support | Community | Email | Dedicated |

### Notes

- If you can't commit to numbers yet, even *"hosted plans coming Q3"* is better than nothing. Silence on pricing kills trust.
- The pricing page itself can have the full table; the landing page just needs a credible signal.

---

## Section 10 — Integrations Strip

**Purpose:** Prove you fit the stack the reader already has.

### Layout

One horizontal row of logos / pill tags, optionally split into sub-groups:

- **Models:** Anthropic, OpenAI, [others as supported]
- **Runtimes:** Node 20+, Vercel, Cloudflare Workers, Docker, Kubernetes
- **Stores:** Postgres, SQLite
- **Tool protocols:** MCP, HTTP, Local

### Notes

- Confirm the supported model providers list from `@agntz/core` before publishing.
- MCP support is a real selling point right now — call it out by name.

---

## Section 11 — Bottom CTA

**Purpose:** Singular action. Don't compete with yourself.

### Copy

**H2:** Ship your first agent in 5 minutes.

**Subhead:** Open source. MIT licensed. Self-host or use the hosted version.

**Buttons:** `[ Get Started ]`   `[ View on GitHub ]`   `[ Read the Docs ]`

---

## Section 12 — Footer

Standard four-column layout:

- **Product:** Features · Pricing · Changelog · Roadmap
- **Developers:** Docs · SDK Reference · Examples · GitHub
- **Resources:** Blog · Discord · Community · Status
- **Company:** About · Contact · Privacy · Terms

---

## Production Assets Needed

Before the page can ship, design / content needs to produce:

1. **Annotated trace screenshot** for Section 4 (observability spotlight) — pulled from `packages/app/src/...trace-detail`.
2. **Screen recording, 5–10s** of the trace UI being used. Stretch goal but high-leverage.
3. **Editor + versions mockup** for Section 5 (versioning spotlight) — depends on the UI being built in Path A.
4. **Trace screenshot showing parallel + sequential composition** for Section 6.
5. **Integration logo set** for Section 10 — match the styling of the rest of the page.
6. **OG image / Twitter card** — separate spec, but flag it early.

Optional but high-leverage:

- **Interactive code snippet** (CodeSandbox / Stackblitz) embedded somewhere on the page so devs can `agntz.agents.run(...)` without leaving.
- **One-click deploy button** (Railway, Vercel, Render) for the self-host path.

---

## Product Work Required Before Launch (Path A)

The landing page makes claims that depend on the following engineering work. Each item links a marketing claim to the code path that has to change:

### 1. Separate save from activate

Today, `AgentStore.putAgent()` auto-sets `activatedAt: now` (see `packages/core/src/stores/json-file.ts:178-182` and equivalents in `postgres-store.ts`, `sqlite-store.ts`). For the "save creates a version, pin chooses what ships" copy to be honest, saves must create *inactive* versions and pinning must be a deliberate second action.

**Change:** `putAgent` writes a new version with `activatedAt: null`. A separate `activateAgentVersion(id, createdAt)` call (already exists in the interface) is the explicit pin. The UI gets a distinct "Pin this version" action.

### 2. `agentId@version` resolution in the SDK + runtime

Today, `RunInput.agentId` is a plain string. The runner calls `agentStore.getAgent(agentId)` which returns the active version. There is no path to address a specific version via the SDK.

**Change:** Parse `agentId@version` in the worker (or in `runner.resolveAgent`). If a version suffix is present, route to `getAgentVersion(id, createdAt)`. Update SDK types to document the syntax (`agentId` accepts `"<id>"` or `"<id>@<timestamp>"` or `"<id>@<keyword>"`).

### 3. Keyword aliases (`@latest`, optional user-defined like `@canary`, `@known-good`)

**Change (minimum):** Hardcode `@latest` to resolve to the most-recent `createdAt` regardless of activation state.

**Change (full):** Add an aliases table to `AgentStore` — `(agent_id, alias, created_at)` — and resolve `@<alias>` against it during agent resolution. UI to manage aliases.

### 4. "Compare two versions side-by-side"

Section 5 (versioning spotlight) claims this. If diff view doesn't exist yet in `packages/app`, either build it or remove the line from the copy.

### 5. "Score outputs against evals"

Section 4 (observability spotlight) claims this. Confirm with engineering whether evals are real, roadmapped, or aspirational. If aspirational, swap for `"Replay them to debug regressions."`

---

## Open Decisions

Things still to nail down before publishing:

1. **Headline:** which of the three H1 options? Recommend #1 (*"Ship AI in your product. See every step it takes."*).
2. **Pricing numbers:** even a minimal "$X/mo starter" needs a real X.
3. **Comparison page:** build `/vs-langchain` separately? Recommend yes, but not on the landing.
4. **Logo wall / testimonials:** skip until 3+ recognizable names exist.
5. **`agntz.co` baseUrl:** confirm before hardcoding in hero snippet.
6. **Supported model providers:** lock the list for Section 10 before publishing.
7. **Migration guide for Card 2:** does it exist, or does the link 404? If 404, point all three cards at the quickstart for now.

---

*Last updated: 2026-05-17. Reflects `@agntz/client@1.0.0` and `@agntz/manifest@1.0.0` schemas.*
