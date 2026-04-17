import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Open-Source Agent Builder and Runner",
  description:
    "Build agents as portable config, run them locally or in your own stack, and use a hosted workspace when you want the convenience.",
};

const featureCards = [
  {
    title: "Portable agents, not trapped app code",
    description:
      "Define agents as portable YAML or JSON-serializable objects, version them, and move them between local dev, hosted workspaces, and your own infra.",
  },
  {
    title: "MCP and local tools in the same loop",
    description:
      "Inline tools, MCP servers, agent-as-tool composition, sessions, shared context, and structured outputs live in one runner model instead of scattered glue code.",
  },
  {
    title: "MIT-licensed core, hosted when useful",
    description:
      "Self-host the worker, UI, and store if control matters. Use the hosted service if you just want to build, run, and ship agents without wiring the stack yourself.",
  },
];

const proofPills = [
  "MIT licensed",
  "GitHub-first",
  "Self-hostable worker + UI",
  "Hosted service uses the same core",
];

const trustStatements = [
  "Clone it, run it, and deploy it yourself.",
  "Keep the hosted path when convenience matters.",
  "Move between both without rethinking the product model.",
  "Own your data, auth, worker, and runtime when needed.",
];

const workflowSteps = [
  "Create an agent in YAML or TypeScript.",
  "Run it with tools, sessions, and streaming.",
  "Promote it to the hosted workspace or deploy the same stack yourself.",
];

const exampleCards = [
  {
    eyebrow: "Manifest",
    title: "YAML agent definitions",
    code: `id: support
name: Support Agent
kind: llm

model:
  provider: openai
  name: gpt-5.4-mini

instruction: |
  Help customers clearly and concisely.
  Use tools whenever order data is needed.`,
  },
  {
    eyebrow: "SDK",
    title: "Run it from TypeScript",
    code: `const runner = createRunner({ tools: [lookupOrder] });

runner.registerAgent(defineAgent({
  id: "support",
  model: { provider: "openai", name: "gpt-5.4" },
  tools: [{ type: "inline", name: "lookup_order" }],
}));

const result = await runner.invoke("support", "Where is order 12345?");`,
  },
  {
    eyebrow: "Deploy",
    title: "Own the stack when you need to",
    code: `docker run -d --name ar-pg -p 5432:5432 \\
  -e POSTGRES_PASSWORD=postgres postgres:16

pnpm --filter @agntz/worker dev
pnpm --filter @agntz/app dev

# or deploy the same pieces to your own infra`,
  },
];

export default function Home() {
  const hostedHref = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.agntz.co";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#08111b] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(110,231,255,0.18),_transparent_30%),radial-gradient(circle_at_80%_10%,_rgba(255,173,94,0.18),_transparent_25%),linear-gradient(180deg,_#0b1624_0%,_#08111b_48%,_#050b12_100%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-white/12" />

      <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-6 sm:px-8 lg:px-10 lg:pb-28">
        <header className="flex flex-col gap-4 rounded-full border border-white/10 bg-white/5 px-5 py-4 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-sm font-semibold tracking-[0.24em] text-cyan-100">
              AG
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-100/70">
                agntz.co
              </div>
              <div className="text-sm text-white/72">
                Open-source agent builder and runner
              </div>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-3 text-sm text-white/70">
            <Link href="#examples" className="transition hover:text-white">
              Examples
            </Link>
            <Link href="#screenshots" className="transition hover:text-white">
              Screenshots
            </Link>
            <Link href="#deploy" className="transition hover:text-white">
              Deploy
            </Link>
            <Link
              href="https://github.com/aparry3/agntz"
              className="rounded-full border border-white/12 px-4 py-2 text-white transition hover:bg-white/8"
            >
              View on GitHub
            </Link>
            <Link
              href={hostedHref}
              className="rounded-full bg-[#f4efe6] px-4 py-2 font-medium text-[#0b1624] transition hover:bg-white"
            >
              Open Hosted App
            </Link>
          </nav>
        </header>

        <section className="grid gap-12 pb-16 pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(460px,0.9fr)] lg:items-center lg:pt-20">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
              Open source first. Hosted second.
            </div>
            <h1
              className="mt-7 max-w-4xl text-5xl leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Open-source agent builder and runner for teams that want control.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/72 sm:text-xl">
              agntz.co starts with a real GitHub repo, a self-hostable worker, and portable agent
              definitions. The hosted service is the convenience layer on top of that same core,
              not a separate closed product.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              {proofPills.map((pill) => (
                <div
                  key={pill}
                  className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/72"
                >
                  {pill}
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="https://github.com/aparry3/agntz"
                className="inline-flex items-center justify-center rounded-full bg-[#f4efe6] px-6 py-3 text-sm font-semibold text-[#08111b] transition hover:bg-white"
              >
                View Source on GitHub
              </Link>
              <Link
                href={hostedHref}
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/6 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Open Hosted App
              </Link>
            </div>

            <p className="mt-4 text-sm text-white/48">
              Hosted workspace lives at <span className="font-medium text-white/80">app.agntz.co</span>.
              Self-host the same core stack with your own database, worker, and auth, or start
              hosted and move later.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {featureCards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 backdrop-blur"
                >
                  <h2 className="text-base font-semibold text-white">{card.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-white/62">{card.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5" id="screenshots">
            <HeroScreenshot />
            <div className="grid gap-5 md:grid-cols-2">
              <DeploymentCard />
              <GitHubCard />
            </div>
          </div>
        </section>

        <section className="grid gap-5 border-y border-white/10 py-10 md:grid-cols-4">
          {trustStatements.map((item) => (
            <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
              <div className="text-sm font-medium text-white/80">{item}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-12 py-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
              Why This Shape
            </div>
            <h2
              className="mt-5 text-4xl tracking-[-0.04em] text-white sm:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Open-source core, hosted convenience, no dead-end migration path.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-white/68">
              The landing page should lead with the open-source reality of the product because that
              is what makes the hosted offer more credible. Self-hosting is not marketing garnish
              here. It is part of the product model.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {workflowSteps.map((step, index) => (
              <div
                key={step}
                className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5"
              >
                <div className="text-sm font-semibold text-cyan-100/80">0{index + 1}</div>
                <p className="mt-5 text-base leading-7 text-white/78">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-8" id="examples">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
                Examples
              </div>
              <h2
                className="mt-4 text-4xl tracking-[-0.04em] text-white sm:text-5xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                The product can show real workflows, not vague AI promises.
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-white/58">
              These snippets mirror the repo: YAML manifests, TypeScript registration, and a stack
              you can run locally or deploy in your own environment.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {exampleCards.map((card) => (
              <div
                key={card.title}
                className="rounded-[1.8rem] border border-white/10 bg-[#0c1724] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.24)]"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
                  {card.eyebrow}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">{card.title}</h3>
                <CodeBlock className="mt-4">{card.code}</CodeBlock>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 py-16 lg:grid-cols-2" id="deploy">
          <div className="rounded-[2rem] border border-emerald-300/18 bg-[linear-gradient(180deg,rgba(20,83,45,0.3),rgba(7,18,13,0.7))] p-7">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-100/70">
              Self-host
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-white">
              Run the whole stack in your own environment.
            </h2>
            <p className="mt-4 text-base leading-7 text-emerald-50/72">
              Use the TypeScript SDK, the worker, and the builder UI with Postgres, your auth
              setup, your secrets, and your deploy model.
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-emerald-50/72">
              <li>Portable manifests and JSON-serializable agent definitions</li>
              <li>Own the worker, data store, API keys, and deployment policy</li>
              <li>No rewrite required if you start hosted and move later</li>
            </ul>
            <div className="mt-8">
              <Link
                href="https://github.com/aparry3/agntz"
                className="inline-flex rounded-full border border-emerald-100/18 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/8"
              >
                Explore the GitHub repo
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-amber-200/18 bg-[linear-gradient(180deg,rgba(140,85,27,0.28),rgba(13,11,8,0.72))] p-7">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-100/72">
              Hosted Service
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-white">
              Use the hosted workspace when the value is speed.
            </h2>
            <p className="mt-4 text-base leading-7 text-amber-50/72">
              Build agents, version them, run sessions, inspect logs, and share a common control
              plane at <span className="font-medium text-white">app.agntz.co</span>.
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-amber-50/72">
              <li>Multi-tenant builder UI with auth, providers, logs, and sessions</li>
              <li>Hosted convenience for teams that do not want to wire the control plane</li>
              <li>Still aligned with the open-source runtime instead of a separate product</li>
            </ul>
            <div className="mt-8">
              <Link
                href={hostedHref}
                className="inline-flex rounded-full bg-[#f4efe6] px-5 py-3 text-sm font-semibold text-[#08111b] transition hover:bg-white"
              >
                Open Hosted App
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[2.25rem] border border-white/10 bg-white/[0.04] p-7 sm:p-10">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
                Final CTA
              </div>
              <h2
                className="mt-4 text-4xl tracking-[-0.04em] text-white sm:text-5xl"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Start hosted, self-host later, or stay fully open from day one.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/68">
                agntz.co should read as an open-source platform first. The hosted workspace is
                there because some teams want less setup, not because the core product only exists
                behind the service.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link
                href="https://github.com/aparry3/agntz"
                className="inline-flex items-center justify-center rounded-full bg-[#f4efe6] px-6 py-3 text-sm font-semibold text-[#08111b] transition hover:bg-white"
              >
                View Source on GitHub
              </Link>
              <Link
                href={hostedHref}
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/8"
              >
                Open Hosted App
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function HeroScreenshot() {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-white/12 bg-[#0c1724] shadow-[0_30px_120px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-rose-300/90" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-200/90" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-300/90" />
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/52">
          Screenshot / Builder
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[1.5rem] border border-cyan-300/12 bg-[#0a1320] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-cyan-100/55">Agent</div>
              <div className="mt-2 text-lg font-semibold text-white">Research Assistant</div>
            </div>
            <div className="rounded-full bg-emerald-300/12 px-3 py-1 text-xs font-medium text-emerald-100">
              live schema validation
            </div>
          </div>

          <CodeBlock className="mt-4 min-h-[250px]">
            {`id: research-assistant
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini

tools:
  - kind: mcp
    server: github
    tools: [search, fetch_url]

instruction: |
  Research the topic, cite sources, and return
  a concise summary with next steps.`}
          </CodeBlock>
        </div>

        <div className="space-y-5">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.28em] text-cyan-100/55">
                  Run Panel
                </div>
                <div className="mt-2 text-lg font-semibold text-white">Streaming session</div>
              </div>
              <div className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/70">sess_01H...</div>
            </div>

            <div className="mt-4 space-y-3">
              <ChatBubble
                label="Input"
                accent="border-cyan-300/18 bg-cyan-300/8 text-cyan-50"
                text="Research how MCP changes internal agent tooling and summarize the implications for platform teams."
              />
              <ChatBubble
                label="Tool"
                accent="border-amber-200/18 bg-amber-200/8 text-amber-50"
                text="search_for_user -> 6 results, 2 selected, 1 fetch in progress"
              />
              <ChatBubble
                label="Output"
                accent="border-emerald-300/18 bg-emerald-300/8 text-emerald-50"
                text="MCP turns external capabilities into a first-class tool source. The practical win is less one-off adapter code and a cleaner permission model."
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard value="13" label="tool calls" />
            <MetricCard value="2.4s" label="time to first token" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DeploymentCard() {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
        Screenshot / Deploy
      </div>
      <h3 className="mt-3 text-lg font-semibold text-white">One runner, different operating models</h3>
      <div className="mt-5 grid gap-3">
        {[
          "SDK and manifests",
          "Hosted workspace",
          "Self-hosted worker",
          "Postgres / your store",
        ].map((item, index) => (
          <div
            key={item}
            className="flex items-center justify-between rounded-2xl border border-white/8 bg-[#0d1723] px-4 py-3 text-sm text-white/76"
          >
            <span>{item}</span>
            <span className="rounded-full bg-white/8 px-2 py-1 text-[11px] text-white/46">
              0{index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GitHubCard() {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
        GitHub / Local Dev
      </div>
      <h3 className="mt-3 text-lg font-semibold text-white">Clone it and run the stack locally</h3>
      <CodeBlock className="mt-4">{`git clone https://github.com/aparry3/agntz
cd agntz
pnpm install
cp .env.example .env.local
pnpm --filter @agntz/worker dev
pnpm --filter @agntz/app dev`}</CodeBlock>
    </div>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-[#0b1521] p-4">
      <div className="text-2xl font-semibold tracking-[-0.03em] text-white">{value}</div>
      <div className="mt-2 text-sm text-white/58">{label}</div>
    </div>
  );
}

function ChatBubble({
  label,
  text,
  accent,
}: {
  label: string;
  text: string;
  accent: string;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${accent}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em]">{label}</div>
      <p className="mt-2 text-sm leading-6">{text}</p>
    </div>
  );
}

function CodeBlock({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <pre
      className={`overflow-x-auto rounded-[1.4rem] border border-white/10 bg-[#07101a] p-4 text-[13px] leading-6 text-white/82 ${className}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <code>{children}</code>
    </pre>
  );
}
