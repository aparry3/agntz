"use client";

import { useState } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, Code, H2, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ArrowIcon, CheckIcon } from "./icons";

const BULLETS: [string, string][] = [
  ["Full execution graph", "Spans for every model call, tool call, and child agent."],
  [
    "Trace → version pin",
    "Jump from any trace straight to the agent version that produced it.",
  ],
  [
    "Replay & compare",
    "Re-run any historic invocation against a new version side-by-side.",
  ],
];

export function ObservabilitySpotlight({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="observability" kicker="Spotlight · 01 — Observability">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.85fr 1.15fr",
          gap: 72,
          alignItems: "center",
        }}
      >
        <Stack gap={24}>
          <H2 size={48}>
            Every step.
            <br />
            Every token.
            <br />
            Every version — <span style={{ color: TOKENS.muted }}>traced.</span>
          </H2>
          <Lede>
            See the prompt. See the response. See every tool call. See the version that ran it.
            Replay any run. Compare runs. Score outputs against evals.
          </Lede>
          <p
            style={{
              margin: 0,
              color: TOKENS.text2,
              fontSize: 14.5,
              lineHeight: 1.6,
              maxWidth: 460,
            }}
          >
            No OpenTelemetry duct tape. No second vendor. The observability layer ships with the
            framework, not as a separate <Code accent={accent}>$400/mo</Code> tool.
          </p>
          <Stack gap={10}>
            {BULLETS.map(([h, b], i) => (
              <Row key={i} gap={12} style={{ alignItems: "flex-start" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: `1px solid ${ACCENTS[accent].line}`,
                    background: ACCENTS[accent].bg,
                    color: ACCENTS[accent].fg,
                    flexShrink: 0,
                  }}
                >
                  <CheckIcon />
                </span>
                <Stack gap={2}>
                  <span style={{ fontWeight: 500, fontSize: 14.5 }}>{h}</span>
                  <span style={{ color: TOKENS.text2, fontSize: 13.5, lineHeight: 1.5 }}>{b}</span>
                </Stack>
              </Row>
            ))}
          </Stack>
          <Btn size="md" style={{ marginTop: 8, alignSelf: "flex-start" }}>
            View a live trace <ArrowIcon />
          </Btn>
        </Stack>

        <TracePanel accent={accent} />
      </div>
    </Section>
  );
}

type Span = {
  d: number;
  k: string;
  n: string;
  t: string;
  off: number;
  w: number;
  color: string;
};

function TracePanel({ accent }: { accent: AccentName }) {
  const [selected, setSelected] = useState(2);
  const spans: Span[] = [
    { d: 0, k: "agent.invoke", n: "support-agent", t: "1.84s", off: 0, w: 100, color: TOKENS.ink },
    {
      d: 1,
      k: "agent.runtime.resolve",
      n: "v · 2026-05-15 09:12",
      t: "4ms",
      off: 0,
      w: 1,
      color: ACCENTS[accent].fg,
    },
    {
      d: 1,
      k: "model.call",
      n: "claude-sonnet-4-6",
      t: "612ms",
      off: 1,
      w: 33,
      color: ACCENTS.purple.fg,
    },
    {
      d: 1,
      k: "tool.execute",
      n: "lookup_customer",
      t: "84ms",
      off: 35,
      w: 5,
      color: ACCENTS.amber.fg,
    },
    { d: 1, k: "tool.execute", n: "search_kb", t: "210ms", off: 41, w: 12, color: ACCENTS.amber.fg },
    {
      d: 1,
      k: "model.call",
      n: "claude-sonnet-4-6",
      t: "933ms",
      off: 54,
      w: 46,
      color: ACCENTS.purple.fg,
    },
  ];

  return (
    <Card
      style={{
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(26,25,22,0.10), 0 4px 12px rgba(26,25,22,0.05)",
      }}
    >
      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: `1px solid ${TOKENS.line}`,
          background: TOKENS.warm,
        }}
      >
        <Row gap={6} style={{ alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 9, height: 9, borderRadius: 99, background: TOKENS.line }} />
          <span
            style={{
              marginLeft: 14,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: TOKENS.text2,
            }}
          >
            Traces / trc_01H8K2X9PY42
          </span>
        </Row>
        <Pill accent="green" dot mono>
          200 OK · 4,217 tok
        </Pill>
      </Row>

      <Row
        style={{
          borderBottom: `1px solid ${TOKENS.line}`,
          background: TOKENS.surface,
          paddingLeft: 14,
        }}
      >
        {["Spans", "Input", "Output", "Cost", "Replay"].map((t, i) => (
          <span
            key={t}
            style={{
              padding: "10px 14px",
              fontSize: 12,
              fontFamily: "var(--mono)",
              color: i === 0 ? TOKENS.ink : TOKENS.muted,
              borderBottom: i === 0 ? `2px solid ${TOKENS.ink}` : "2px solid transparent",
              fontWeight: i === 0 ? 600 : 400,
            }}
          >
            {t}
          </span>
        ))}
      </Row>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr" }}>
        <Stack
          gap={0}
          style={{ padding: "10px 14px 14px", borderRight: `1px solid ${TOKENS.line}` }}
        >
          <Row
            style={{
              marginBottom: 8,
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: TOKENS.muted,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ width: 270 }}>span</span>
            <span style={{ flex: 1 }}>1.84s timeline</span>
            <span style={{ width: 56, textAlign: "right" }}>duration</span>
          </Row>
          {spans.map((s, i) => {
            const isSel = i === selected;
            return (
              <Row
                key={i}
                onClick={() => setSelected(i)}
                style={{
                  padding: "6px 0",
                  alignItems: "center",
                  borderTop: i > 0 ? `1px dashed ${TOKENS.line2}` : "none",
                  background: isSel ? ACCENTS[accent].bg : "transparent",
                  marginInline: -8,
                  paddingInline: 8,
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                <Row gap={6} style={{ alignItems: "center", width: 270, paddingLeft: s.d * 14 }}>
                  <span
                    style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }}
                  />
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.muted }}>
                    {s.k}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: TOKENS.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 140,
                    }}
                  >
                    {s.n}
                  </span>
                </Row>
                <div style={{ flex: 1, height: 16, position: "relative", background: "transparent" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: `${s.off}%`,
                      width: `${Math.max(s.w, 0.6)}%`,
                      top: 4,
                      bottom: 4,
                      background: s.color,
                      opacity: s.d === 0 ? 1 : 0.85,
                      borderRadius: 2,
                      minWidth: s.d === 0 ? 0 : 4,
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 56,
                    textAlign: "right",
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: TOKENS.text2,
                  }}
                >
                  {s.t}
                </span>
              </Row>
            );
          })}
        </Stack>

        <Stack gap={14} style={{ padding: "14px 16px", background: TOKENS.warm }}>
          <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
            <Pill accent="amber" mono>
              tool.execute · search_kb
            </Pill>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.text2 }}>210ms</span>
          </Row>
          <Stack gap={6}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: TOKENS.muted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              input
            </span>
            <div
              style={{
                background: TOKENS.surface2,
                border: `1px solid ${TOKENS.line}`,
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: TOKENS.text2 }}>query:</span>{" "}
              <span>&quot;refund policy duplicate charge&quot;</span>
              <br />
              <span style={{ color: TOKENS.text2 }}>limit:</span>{" "}
              <span style={{ color: TOKENS.ok }}>3</span>
            </div>
          </Stack>
          <Stack gap={6}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: TOKENS.muted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              output · 3 docs
            </span>
            <div
              style={{
                background: TOKENS.surface2,
                border: `1px solid ${TOKENS.line}`,
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "var(--mono)",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: TOKENS.text2,
              }}
            >
              [kb_refund_001, kb_billing_044, kb_charge_077]
            </div>
          </Stack>
          <Row
            style={{
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 8,
              borderTop: `1px dashed ${TOKENS.line}`,
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.text2 }}>
              version:
            </span>
            <Pill accent={accent} dot mono>
              support-agent · v 2026-05-15 09:12
            </Pill>
          </Row>
        </Stack>
      </div>
    </Card>
  );
}
