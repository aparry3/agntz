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
    d: "Author in YAML, the UI, or via SDK. Every save creates a new version in your store.",
    lang: "yaml",
    filename: "support-agent.yaml",
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

tools:
  - kind: local
    tools: [lookup_customer, search_kb]`,
  },
  {
    n: 2,
    t: "Call it from your code",
    d: "One call from any service, edge function, or worker. The runtime resolves the active version.",
    lang: "ts",
    filename: "app.ts",
    code: `import { AgntzClient } from '@agntz/sdk';

const agntz = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
});

const { output } = await agntz.agents.run({
  agentId: 'support-agent',
  input: {
    message: email.body,
    customerId: email.from,
  },
});`,
  },
  {
    n: 3,
    t: "Observe, iterate, pin",
    d: "Every run is traced. Test against @latest. Pin the version that's ready. Roll back in a click.",
    lang: "ts",
    filename: "test.ts",
    code: `// Test the newest save before promoting
await agntz.agents.run({
  agentId: 'support-agent@latest',
  input: { message },
});

// Or any version, by timestamp or alias
await agntz.agents.run({
  agentId: 'support-agent@known-good',
  input: { message },
});`,
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
          href="#"
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
          View a live trace from this exact pipeline <ArrowIcon />
        </a>
      </Row>
    </Section>
  );
}
