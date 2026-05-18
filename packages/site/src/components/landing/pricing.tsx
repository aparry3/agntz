import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, H1, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ArrowIcon, CheckIcon } from "./icons";

type Tier = {
  name: string;
  price: string;
  sub: string;
  tagline: string;
  bullets: string[];
  cta: string;
  ghost?: boolean;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "OSS",
    price: "Free",
    sub: "forever",
    tagline: "Self-host the whole stack.",
    bullets: [
      "Unlimited runs on your infra",
      "MIT license, no strings",
      "Community support on Discord",
      "Bring your own Postgres / SQLite",
    ],
    cta: "Clone the repo",
    ghost: true,
  },
  {
    name: "Hosted Starter",
    price: "$49",
    sub: "/mo",
    tagline: "Skip the operations.",
    bullets: ["100k runs / mo", "5 seats", "Email support", "Same OSS feature set"],
    cta: "Start free",
    featured: true,
  },
  {
    name: "Team",
    price: "Custom",
    sub: "",
    tagline: "Production scale + assurance.",
    bullets: [
      "Unlimited runs & seats",
      "SSO + RBAC + audit logs",
      "99.9% SLA on paid tiers",
      "Dedicated support channel",
    ],
    cta: "Talk to us",
  },
];

export function Pricing({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="pricing" kicker="Pricing">
      <div
        style={{
          marginBottom: 48,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H1 size={48} style={{ fontWeight: 500 }}>
          Free forever, self-hosted.
          <br />
          <span style={{ color: TOKENS.muted }}>
            Hosted plans for when you want less yak-shaving.
          </span>
        </H1>
        <Lede>
          Devs won&apos;t commit without seeing a number. Here are some numbers. The OSS edition is
          the real product — the hosted edition is operational relief on top of the same code.
        </Lede>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {TIERS.map((t) => (
          <Card
            key={t.name}
            style={{
              padding: 28,
              minHeight: 380,
              display: "flex",
              flexDirection: "column",
              background: t.featured ? TOKENS.ink : TOKENS.surface2,
              borderColor: t.featured ? TOKENS.ink : TOKENS.line,
              color: t.featured ? TOKENS.bg : TOKENS.ink,
              position: "relative",
              boxShadow: t.featured
                ? "0 12px 32px rgba(26,25,22,0.16)"
                : "0 1px 0 rgba(26,25,22,0.03)",
            }}
          >
            {t.featured && (
              <Pill
                accent={accent}
                dot
                mono
                style={{
                  position: "absolute",
                  top: -10,
                  left: 24,
                  background: ACCENTS[accent].bg,
                  color: ACCENTS[accent].fg,
                }}
              >
                most popular
              </Pill>
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: t.featured ? "rgba(244,241,233,0.65)" : TOKENS.muted,
                marginBottom: 14,
              }}
            >
              {t.name}
            </span>
            <Row gap={4} style={{ alignItems: "baseline", marginBottom: 6 }}>
              <H1 size={44} style={{ letterSpacing: "-0.03em" }}>
                {t.price}
              </H1>
              <span
                style={{
                  color: t.featured ? "rgba(244,241,233,0.65)" : TOKENS.muted,
                  fontSize: 15,
                }}
              >
                {t.sub}
              </span>
            </Row>
            <p
              style={{
                margin: "0 0 22px",
                fontSize: 14,
                color: t.featured ? "rgba(244,241,233,0.7)" : TOKENS.text2,
              }}
            >
              {t.tagline}
            </p>
            <Stack gap={10} style={{ flex: 1, marginBottom: 22 }}>
              {t.bullets.map((b) => (
                <Row
                  key={b}
                  gap={10}
                  style={{
                    alignItems: "flex-start",
                    fontSize: 13.5,
                    lineHeight: 1.45,
                    color: t.featured ? "rgba(244,241,233,0.85)" : TOKENS.ink,
                  }}
                >
                  <span
                    style={{
                      color: t.featured ? TOKENS.bg : ACCENTS[accent].fg,
                      display: "inline-flex",
                      marginTop: 2,
                    }}
                  >
                    <CheckIcon />
                  </span>
                  <span>{b}</span>
                </Row>
              ))}
            </Stack>
            <Btn
              primary={!t.featured && !t.ghost}
              size="md"
              style={
                t.featured
                  ? { background: TOKENS.bg, color: TOKENS.ink, borderColor: TOKENS.bg }
                  : t.ghost
                    ? { background: "transparent" }
                    : undefined
              }
            >
              {t.cta} <ArrowIcon />
            </Btn>
          </Card>
        ))}
      </div>
    </Section>
  );
}
