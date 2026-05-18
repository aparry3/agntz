import type { ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, H2, Lede, Row, Section } from "./primitives";
import { ArrowIcon, BranchIcon, CubeIcon, EyeIcon } from "./icons";

type Door = {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  ic: ReactNode;
  featured?: boolean;
};

const CARDS: Door[] = [
  {
    eyebrow: "for · platform teams",
    title: "Adding AI to an existing product",
    body: "You have a real app. Drop in one SDK call. Configure agents in YAML or the UI. Ship features without a framework migration or a rewrite around them.",
    cta: "Read the 5-minute quickstart",
    ic: <CubeIcon />,
  },
  {
    eyebrow: "for · AI engineers",
    title: "Outgrowing LangChain or agent spaghetti",
    body: "Your agent code is unmaintainable. Tools and prompts are scattered across files. Debugging means console.log archaeology. Bring it into one declarative manifest.",
    cta: "See the migration guide",
    ic: <BranchIcon />,
    featured: true,
  },
  {
    eyebrow: "for · ops & SRE",
    title: "Need observability your framework doesn't ship",
    body: "You're already paying for Langfuse or Helicone, or duct-taping OpenTelemetry. Get every span, every token, every version — included, not extra.",
    cta: "See a live trace",
    ic: <EyeIcon />,
  },
];

export function WhoItsFor({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section kicker="Who it's for">
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={48}>
          Three doors.
          <br />
          <span style={{ color: TOKENS.muted }}>Pick the one that sounds like you.</span>
        </H2>
        <Lede>
          The wedge isn&apos;t &quot;build agents from scratch.&quot; It&apos;s{" "}
          <i>&quot;you already have an LLM call in your app and it&apos;s getting messy.&quot;</i>{" "}
          agntz is the next step up — not a from-scratch framework.
        </Lede>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {CARDS.map((c, i) => (
          <Card
            key={i}
            style={{
              padding: 26,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 320,
              background: c.featured ? TOKENS.ink : TOKENS.surface2,
              borderColor: c.featured ? TOKENS.ink : TOKENS.line,
              color: c.featured ? TOKENS.bg : TOKENS.ink,
            }}
          >
            <Row gap={10} style={{ alignItems: "center" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${c.featured ? "rgba(244,241,233,0.3)" : TOKENS.line}`,
                  background: c.featured ? "rgba(244,241,233,0.06)" : TOKENS.warm,
                  color: "currentColor",
                }}
              >
                {c.ic}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: c.featured ? "rgba(244,241,233,0.7)" : TOKENS.muted,
                }}
              >
                {c.eyebrow}
              </span>
            </Row>

            <H2 size={22} style={{ fontWeight: 500, lineHeight: 1.15 }}>
              {c.title}
            </H2>

            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                color: c.featured ? "rgba(244,241,233,0.7)" : TOKENS.text2,
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
                gap: 8,
                color: c.featured ? TOKENS.bg : ACCENTS[accent].fg,
                fontSize: 13.5,
                textDecoration: "none",
                fontWeight: 500,
                paddingTop: 12,
                borderTop: `1px solid ${c.featured ? "rgba(244,241,233,0.16)" : TOKENS.line}`,
              }}
            >
              {c.cta} <ArrowIcon />
            </a>
          </Card>
        ))}
      </div>
    </Section>
  );
}
