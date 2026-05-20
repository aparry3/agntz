import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { H2, Lede, Row, Section, Stack } from "./primitives";
import { ArrowIcon } from "./icons";
import { CodeBlock } from "./code-block";

type Step = {
  n: number;
  t: string;
  d: string;
  lang: "ts" | "yaml";
  filename: string;
  code: string;
};

const STEPS: Step[] = [
  {
    n: 1,
    t: "Define your agent",
    d: "Drop a YAML file in ./agents. The runner loads everything in that directory at startup.",
    lang: "yaml",
    filename: "agents/support-agent.yaml",
    code: `id: support-agent
name: Support Triager
kind: llm

model:
  provider: anthropic
  name: claude-sonnet-4-6

instruction: |
  You are a senior support agent.
  Triage support emails and draft
  a friendly, accurate reply.

  {{userQuery}}

tools:
  - kind: local
    tools: [lookup_customer, search_kb]`,
  },
  {
    n: 2,
    t: "Run it from your code",
    d: "Five lines, no server. Pass local tool handlers in the same factory call.",
    lang: "ts",
    filename: "app.ts",
    code: `import { agntz } from '@agntz/runner';

const client = await agntz({
  agents: './agents',
  tools: { lookup_customer, search_kb },
});

const { output } = await client.agents.run({
  agentId: 'support-agent',
  input: email.body,
});`,
  },
  {
    n: 3,
    t: "Observe and iterate",
    d: "Every run records a trace in-process. List runs, replay any one, stream events live as they happen.",
    lang: "ts",
    filename: "trace.ts",
    code: `// List recent runs from the in-memory buffer
const { rows } = await client.runs.list({ limit: 10 });

// Pull the full trace for any run
const trace = await client.traces.get(rows[0].id);
for (const span of trace?.spans ?? []) {
  console.log(span.kind, span.name, span.durationMs);
}`,
  },
];

export function HowItWorks({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="how" kicker="How it works" style={{ background: TOKENS.surface }}>
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={48}>
          Define. Call. Iterate.
          <br />
          <span style={{ color: TOKENS.muted }}>Three steps from idea to production.</span>
        </H2>
        <Lede>
          No framework migration. No glue code. The same manifest schema whether your agent is one
          model call or twelve.
        </Lede>
      </div>

      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 24,
            left: "16%",
            right: "16%",
            height: 1,
            background: `repeating-linear-gradient(90deg, ${TOKENS.line} 0 6px, transparent 6px 12px)`,
            zIndex: 0,
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 24,
            position: "relative",
          }}
        >
          {STEPS.map((s) => (
            <Stack key={s.n} gap={18} style={{ position: "relative", zIndex: 1 }}>
              <Row gap={12} style={{ alignItems: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 99,
                    background: TOKENS.ink,
                    color: TOKENS.bg,
                    fontFamily: "var(--mono)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {s.n}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: TOKENS.muted,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}
                >
                  step 0{s.n}
                </span>
              </Row>
              <Stack gap={8}>
                <H2 size={22} style={{ fontWeight: 500 }}>
                  {s.t}
                </H2>
                <p
                  style={{
                    margin: 0,
                    color: TOKENS.text2,
                    fontSize: 14.5,
                    lineHeight: 1.55,
                    textWrap: "pretty",
                  }}
                >
                  {s.d}
                </p>
              </Stack>
              <CodeBlock filename={s.filename} lang={s.lang}>
                {s.code}
              </CodeBlock>
            </Stack>
          ))}
        </div>
      </div>

      <Row gap={12} style={{ marginTop: 48, alignItems: "center" }}>
        <a
          href="/docs"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: ACCENTS[accent].fg,
            fontSize: 14,
            textDecoration: "none",
            fontWeight: 500,
            borderBottom: `1px solid ${ACCENTS[accent].line}`,
            paddingBottom: 2,
          }}
        >
          Read the full quickstart <ArrowIcon />
        </a>
      </Row>
    </Section>
  );
}
