import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, H1, Lede, Row, Section, Stack } from "./primitives";
import { ArrowIcon, ExternalIcon, GithubIcon } from "./icons";

const STEPS: [string, string][] = [
  ["1.", "npm i @agntz/sdk"],
  ["2.", "agntz init support-agent"],
  ["3.", "agntz invoke support-agent 'hello'"],
];

export function BottomCTA({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section dark style={{ padding: "112px 0 120px" }}>
      <div
        style={{
          width: "min(1180px, calc(100% - 64px))",
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -28,
            right: 0,
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(244,241,233,0.3)",
          }}
        >
          §11 — ship it
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr",
            gap: 56,
            alignItems: "center",
          }}
        >
          <Stack gap={24}>
            <H1
              size={64}
              style={{ color: TOKENS.bg, letterSpacing: "-0.035em", maxWidth: 640 }}
            >
              Ship your first agent <br />
              <span style={{ color: ACCENTS[accent].bg }}>in five minutes.</span>
            </H1>
            <Lede style={{ color: "rgba(244,241,233,0.7)", maxWidth: 540, fontSize: 18 }}>
              Open source. MIT licensed. Self-host the whole stack, or use the hosted version.
              Every save versioned. Every run traced. From day one.
            </Lede>
            <Row gap={10} style={{ marginTop: 4, flexWrap: "wrap" }}>
              <Btn
                primary
                size="lg"
                style={{ background: TOKENS.bg, color: TOKENS.ink, borderColor: TOKENS.bg }}
              >
                Get started <ArrowIcon />
              </Btn>
              <Btn
                size="lg"
                icon={<GithubIcon />}
                href="https://github.com/aparry3/agntz"
                style={{
                  background: "transparent",
                  color: TOKENS.bg,
                  borderColor: "rgba(244,241,233,0.3)",
                }}
              >
                View on GitHub
              </Btn>
              <Btn
                size="lg"
                style={{ background: "transparent", color: TOKENS.bg, borderColor: "transparent" }}
              >
                Read the docs <ExternalIcon />
              </Btn>
            </Row>
          </Stack>

          <Card dark style={{ padding: 22 }} hover={false}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(244,241,233,0.55)",
              }}
            >
              quick install
            </span>
            <Stack gap={10} style={{ marginTop: 12 }}>
              {STEPS.map(([n, c]) => (
                <Row
                  key={n}
                  gap={10}
                  style={{
                    alignItems: "center",
                    padding: "10px 12px",
                    background: "rgba(244,241,233,0.04)",
                    border: "1px solid rgba(244,241,233,0.1)",
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      color: "rgba(244,241,233,0.45)",
                    }}
                  >
                    {n}
                  </span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: TOKENS.bg }}>
                    {c}
                  </span>
                </Row>
              ))}
            </Stack>
            <p
              style={{
                margin: "16px 0 0",
                fontSize: 12.5,
                color: "rgba(244,241,233,0.55)",
                lineHeight: 1.5,
              }}
            >
              First traced run takes ~5s. Versioned automatically. Pin it when you&apos;re ready.
            </p>
          </Card>
        </div>
      </div>
    </Section>
  );
}
