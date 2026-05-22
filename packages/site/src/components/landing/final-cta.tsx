import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, H1, Lede, Row, Section, Stack } from "./primitives";
import { ArrowIcon, ExternalIcon, GithubIcon } from "./icons";

const STEPS: [string, string, string][] = [
  ["1.", "npm i @agntz/sdk", "install"],
  ["2.", "echo 'id: hello' > agents/hello.yaml", "define"],
  ["3.", "client.agents.run({ agentId: 'hello' })", "run"],
];

export function FinalCTA({ accent = "blue" }: { accent?: AccentName }) {
  const a = ACCENTS[accent];

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
          §08 — ship it
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
              size={72}
              style={{ color: TOKENS.bg, letterSpacing: "-0.04em", maxWidth: 680 }}
            >
              Ship your first agent
              <br />
              <span style={{ color: a.bg }}>today.</span>
            </H1>
            <Lede style={{ color: "rgba(244,241,233,0.7)", maxWidth: 540, fontSize: 18 }}>
              Install the runner. Write a YAML file. Call{" "}
              <code
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: "0.88em",
                  background: "rgba(244,241,233,0.08)",
                  color: TOKENS.bg,
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: "1px solid rgba(244,241,233,0.2)",
                }}
              >
                run
              </code>
              . That&apos;s it.
            </Lede>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 18px",
                background: "rgba(244,241,233,0.04)",
                border: "1px solid rgba(244,241,233,0.16)",
                borderRadius: 8,
                fontFamily: "var(--mono)",
                fontSize: 14,
                alignSelf: "flex-start",
              }}
            >
              <span style={{ color: "rgba(244,241,233,0.45)" }}>$</span>
              <span style={{ color: "rgba(244,241,233,0.75)" }}>npm install</span>
              <span style={{ color: TOKENS.bg }}>@agntz/sdk</span>
              <span
                style={{
                  width: 1,
                  height: 16,
                  background: "rgba(244,241,233,0.16)",
                  margin: "0 4px",
                }}
              />
              <span
                style={{
                  color: "rgba(244,241,233,0.5)",
                  fontSize: 10.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                copy
              </span>
            </div>

            <Row gap={10} style={{ marginTop: 4, flexWrap: "wrap" }}>
              <Btn
                primary
                size="lg"
                href="/docs"
                style={{ background: TOKENS.bg, color: TOKENS.ink, borderColor: TOKENS.bg }}
              >
                Docs <ArrowIcon />
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
                GitHub
              </Btn>
              <Btn
                size="lg"
                style={{
                  background: "transparent",
                  color: TOKENS.bg,
                  borderColor: "rgba(244,241,233,0.3)",
                }}
              >
                Hosted signup <ExternalIcon />
              </Btn>
            </Row>
          </Stack>

          <Card dark style={{ padding: 22 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(244,241,233,0.55)",
              }}
            >
              from zero to traced run
            </span>
            <Stack gap={10} style={{ marginTop: 14 }}>
              {STEPS.map(([n, c, label]) => (
                <Stack
                  key={n}
                  gap={4}
                  style={{
                    padding: "12px 14px",
                    background: "rgba(244,241,233,0.04)",
                    border: "1px solid rgba(244,241,233,0.12)",
                    borderRadius: 6,
                  }}
                >
                  <Row gap={8} style={{ alignItems: "center" }}>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: "rgba(244,241,233,0.45)",
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                      }}
                    >
                      {n} {label}
                    </span>
                  </Row>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: TOKENS.bg,
                      lineHeight: 1.45,
                    }}
                  >
                    {c}
                  </span>
                </Stack>
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
              The whole loop is the runtime&apos;s job. Yours is the YAML.
            </p>
          </Card>
        </div>
      </div>
    </Section>
  );
}
