import type { ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, Code, H2, Lede, Pill, Row, Section } from "./primitives";
import {
  ArrowIcon,
  CheckIcon,
  CodeIcon,
  CubeIcon,
  EyeIcon,
  ServerIcon,
  SparkIcon,
} from "./icons";

type Cap = {
  title: string;
  body: string;
  icon: ReactNode;
  link: string;
  tag: "shipped" | "planned";
};

const CAPS: Cap[] = [
  {
    title: "Agent loop",
    body: "Tool calling, multi-step reasoning, automatic retries on transient failure. You don't write the while-loop.",
    icon: <SparkIcon />,
    link: "the agent loop",
    tag: "shipped",
  },
  {
    title: "Sessions",
    body: "Resumable across processes. Multimodal input. Reply to any past session — state is durable, not in-memory.",
    icon: <CubeIcon />,
    link: "sessions",
    tag: "shipped",
  },
  {
    title: "Tools",
    body: "MCP servers, HTTP APIs, and local TypeScript functions — declared the same way. OAuth2, refresh, and credential redaction included.",
    icon: <ServerIcon />,
    link: "tools",
    tag: "shipped",
  },
  {
    title: "Context management",
    body: "Windowing and summarization handled by the runtime. Long sessions don't blow past the model's context.",
    icon: <CodeIcon />,
    link: "context",
    tag: "shipped",
  },
  {
    title: "Tracing",
    body: "Every step, every tool call, every token — captured. JSON locally; full timeline UI in hosted.",
    icon: <EyeIcon />,
    link: "tracing",
    tag: "shipped",
  },
  {
    title: "Evals",
    body: "Score outputs against fixtures, regress on every change, and gate deploys. UI ships with the hosted plan.",
    icon: <CheckIcon />,
    link: "evals",
    tag: "planned",
  },
];

export function RuntimeCapabilities({ accent = "blue" }: { accent?: AccentName }) {
  const a = ACCENTS[accent];

  return (
    <Section id="capabilities" kicker="What the runtime handles" style={{ background: TOKENS.surface }}>
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={56} style={{ letterSpacing: "-0.035em" }}>
          The hard parts,
          <br />
          <span style={{ color: TOKENS.muted }}>done.</span>
        </H2>
        <Lede>
          Everything the runtime handles so you don&apos;t have to build, test, and maintain it.
          Shipped in v1.0. Items marked <Code accent="amber">planned</Code> are next.
        </Lede>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {CAPS.map((c, i) => (
          <Card
            key={c.title}
            hover
            style={{
              padding: 26,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 260,
              background: TOKENS.surface2,
              borderColor: TOKENS.line,
            }}
          >
            <Row gap={10} style={{ alignItems: "center", justifyContent: "space-between" }}>
              <Row gap={10} style={{ alignItems: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: 6,
                    border: `1px solid ${TOKENS.line}`,
                    background: TOKENS.warm,
                    color: TOKENS.ink,
                  }}
                >
                  {c.icon}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: TOKENS.muted,
                  }}
                >
                  0{i + 1}
                </span>
              </Row>
              <Pill accent={c.tag === "planned" ? "amber" : "green"} dot mono>
                {c.tag}
              </Pill>
            </Row>

            <H2 size={20} style={{ fontWeight: 500, lineHeight: 1.2 }}>
              {c.title}
            </H2>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.6,
                color: TOKENS.text2,
                textWrap: "pretty",
                flex: 1,
              }}
            >
              {c.body}
            </p>

            <a
              href="#"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                paddingTop: 14,
                marginTop: 4,
                borderTop: `1px solid ${TOKENS.line2}`,
                color: a.fg,
                fontSize: 13,
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              Learn about {c.link} <ArrowIcon />
            </a>
          </Card>
        ))}
      </div>

      <Row gap={12} style={{ marginTop: 24, alignItems: "center", color: TOKENS.muted, fontSize: 13 }}>
        <Pill accent="green" dot mono>
          shipped
        </Pill>
        <span>= in @agntz/runner@1.0.0.</span>
        <Pill accent="amber" dot mono>
          planned
        </Pill>
        <span>= on the near-term roadmap, tracked in the public changelog.</span>
      </Row>
    </Section>
  );
}
