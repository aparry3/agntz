import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, H1, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ArrowIcon, CheckIcon, ExternalIcon, GithubIcon } from "./icons";
import { CodeBlock } from "./code-block";

const HERO_CODE = `import { AgntzClient } from '@agntz/sdk';

const agntz = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
});

// Production always runs the pinned version
const { output } = await agntz.agents.run({
  agentId: 'support-agent',
  input: {
    message: email.body,
    customerId: email.from,
  },
});`;

type HeroSpan = {
  i: number;
  l: string;
  v: string;
  t: string;
  c: string;
  w: number;
  o: number;
};

const HERO_SPANS: HeroSpan[] = [
  { i: 0, l: "agent.invoke", v: "support-agent", t: "1.84s", c: TOKENS.ink, w: 100, o: 0 },
  { i: 1, l: "model.call", v: "claude-sonnet-4-6", t: "612ms", c: ACCENTS.purple.fg, w: 33, o: 0 },
  { i: 1, l: "tool.execute", v: "lookup_customer", t: "84ms", c: ACCENTS.amber.fg, w: 5, o: 34 },
  { i: 1, l: "tool.execute", v: "search_kb", t: "210ms", c: ACCENTS.amber.fg, w: 12, o: 40 },
  { i: 1, l: "model.call", v: "claude-sonnet-4-6", t: "933ms", c: ACCENTS.purple.fg, w: 47, o: 53 },
];

export function Hero({ h1, accent = "blue" }: { h1: string; accent?: AccentName }) {
  return (
    <Section dense style={{ paddingTop: 72, paddingBottom: 72, overflow: "hidden" }}>
      <BgGrid />

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1.04fr 0.96fr",
          gap: 64,
          alignItems: "center",
        }}
      >
        <Stack gap={28}>
          <Row gap={8} style={{ alignItems: "center", flexWrap: "wrap" }}>
            <Pill accent="green" dot>
              v1.0.0 — released
            </Pill>
            <Pill mono>MIT licensed</Pill>
            <Pill mono>Open source</Pill>
          </Row>

          <H1 size={68} style={{ maxWidth: 640 }}>
            {h1}
          </H1>

          <Lede style={{ fontSize: 19, maxWidth: 580 }}>
            Open-source agents you define once, version automatically, and run anywhere.
            Traces, evals, and debugging — built in, not bolted on.
          </Lede>

          <Row gap={10} style={{ marginTop: 4, flexWrap: "wrap" }}>
            <Btn primary size="lg">
              Get started <ArrowIcon />
            </Btn>
            <Btn size="lg" icon={<GithubIcon />} href="https://github.com/aparry3/agntz">
              View on GitHub <ExternalIcon />
            </Btn>
          </Row>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 13,
              alignSelf: "flex-start",
            }}
          >
            <span style={{ color: TOKENS.muted }}>$</span>
            <span>
              <span style={{ color: TOKENS.text2 }}>npm install</span> @agntz/sdk
            </span>
            <span style={{ width: 1, height: 14, background: TOKENS.line, margin: "0 2px" }} />
            <span
              style={{
                color: TOKENS.muted,
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              copy
            </span>
          </div>

          <Row
            gap={20}
            style={{
              marginTop: 6,
              alignItems: "center",
              color: TOKENS.text2,
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <Row gap={6} style={{ alignItems: "center" }}>
              <span style={{ color: ACCENTS[accent].fg, display: "inline-flex" }}>
                <CheckIcon />
              </span>
              Self-hostable
            </Row>
            <Row gap={6} style={{ alignItems: "center" }}>
              <span style={{ color: ACCENTS[accent].fg, display: "inline-flex" }}>
                <CheckIcon />
              </span>
              No lock-in
            </Row>
            <Row gap={6} style={{ alignItems: "center" }}>
              <span style={{ color: ACCENTS[accent].fg, display: "inline-flex" }}>
                <CheckIcon />
              </span>
              Production-ready
            </Row>
          </Row>
        </Stack>

        <Stack gap={14} style={{ position: "relative" }}>
          <CodeBlock filename="app.ts" lang="ts">
            {HERO_CODE}
          </CodeBlock>

          <Card style={{ padding: 14, boxShadow: "0 4px 16px rgba(26,25,22,0.06)" }}>
            <Row style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Row gap={8} style={{ alignItems: "center" }}>
                <Pill accent="green" dot mono>
                  success
                </Pill>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: TOKENS.muted,
                    letterSpacing: "0.06em",
                  }}
                >
                  trc_01H8K2X9PY42
                </span>
              </Row>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.text2 }}>
                1.84s · 4,217 tok
              </span>
            </Row>
            <Stack gap={6}>
              {HERO_SPANS.map((s, k) => (
                <Row
                  key={k}
                  gap={8}
                  style={{ alignItems: "center", fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  <Row gap={6} style={{ alignItems: "center", width: 178, paddingLeft: s.i * 10 }}>
                    <span
                      style={{ width: 6, height: 6, borderRadius: 1, background: s.c, flexShrink: 0 }}
                    />
                    <span style={{ color: TOKENS.muted }}>{s.l}</span>
                    <span
                      style={{
                        color: TOKENS.ink,
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.v}
                    </span>
                  </Row>
                  <div style={{ flex: 1, height: 10, position: "relative" }}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${s.o}%`,
                        width: `${Math.max(s.w, 1)}%`,
                        top: 1,
                        bottom: 1,
                        background: s.c,
                        opacity: s.i === 0 ? 1 : 0.85,
                        borderRadius: 1.5,
                        minWidth: 2,
                      }}
                    />
                  </div>
                  <span style={{ width: 44, textAlign: "right", color: TOKENS.text2 }}>{s.t}</span>
                </Row>
              ))}
            </Stack>
            <Row
              gap={6}
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px dashed ${TOKENS.line2}`,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: TOKENS.muted,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                version
              </span>
              <Pill accent={accent} dot mono>
                support-agent · pinned · 2026-05-15 09:12
              </Pill>
            </Row>
          </Card>
        </Stack>
      </div>

      <div style={{ marginTop: 96, paddingTop: 28, borderTop: `1px solid ${TOKENS.line}` }}>
        <Row
          style={{
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: TOKENS.muted,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Trusted by teams shipping production agents
          </span>
          <Row
            gap={36}
            style={{
              alignItems: "center",
              opacity: 0.55,
              fontFamily: "var(--sans)",
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: TOKENS.ink,
              flexWrap: "wrap",
            }}
          >
            <span>retool</span>
            <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic" }}>linearise</span>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>vercel/co</span>
            <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>POSTHOG</span>
            <span style={{ fontFamily: "Georgia, serif" }}>Replicate</span>
            <span>cohere</span>
          </Row>
        </Row>
      </div>
    </Section>
  );
}

function BgGrid() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `linear-gradient(${TOKENS.line} 1px, transparent 1px), linear-gradient(90deg, ${TOKENS.line} 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
        backgroundPosition: "-1px -1px",
        opacity: 0.5,
        mask: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
        WebkitMask: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
        pointerEvents: "none",
      }}
    />
  );
}
