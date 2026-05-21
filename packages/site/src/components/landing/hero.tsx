"use client";

import { useState } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, H1, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ArrowIcon, CheckIcon, CodeIcon, ExternalIcon, GithubIcon, SparkIcon } from "./icons";
import { highlightTS, highlightYAML } from "./code-block";

const HERO_YAML = `# agent.yaml — the whole agent, declared.
id: weather-bot
kind: llm

model:
  provider: anthropic
  name: claude-sonnet-4-6

instruction: |
  You are a friendly weather assistant.
  When asked about a city, look up the
  forecast and reply in plain language.

tools:
  - kind: http
    name: get_forecast
    description: Current weather for a coordinate.
    url: "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current_weather={current_weather?}"
    method: GET`;

const HERO_RUNNER = `// runner.ts — call your existing APIs, run anywhere.
import { Runner } from '@agntz/sdk';

const runner = new Runner({
  agentsDir: './agents',
});

// Sessions are resumable, multimodal, replyable.
const { sessionId } = await runner.start('weather-bot', {
  input: { message: "What's the weather in Lisbon today?" },
});

const { output } = await runner.run(sessionId);
// → "Lisbon is 21°C and sunny right now, with light
//    winds from the northwest. Expect a clear evening."`;

type Tab = "yaml" | "runner";

export function Hero({ accent = "blue" }: { accent?: AccentName }) {
  const [tab, setTab] = useState<Tab>("yaml");
  const [copied, setCopied] = useState(false);
  const a = ACCENTS[accent];

  async function copyActive() {
    const text = tab === "yaml" ? HERO_YAML : HERO_RUNNER;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context, denied permission) — leave UI untouched
    }
  }

  return (
    <Section dense style={{ paddingTop: 76, paddingBottom: 88, overflow: "hidden" }}>
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
            <Pill mono>declarative runtime</Pill>
            <Pill mono>open source</Pill>
          </Row>

          <H1 size={76} style={{ maxWidth: 680, letterSpacing: "-0.04em" }}>
            Describe your agent.
            <br />
            <span style={{ color: TOKENS.muted }}>Run it.</span>
          </H1>

          <Lede style={{ fontSize: 19, maxWidth: 560 }}>
            A declarative runtime for production agents. Define agents in YAML, call your existing
            APIs, and run anywhere — local, hosted, or self-hosted.
          </Lede>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 8,
              fontFamily: "var(--mono)",
              fontSize: 13.5,
              alignSelf: "flex-start",
              boxShadow: "0 1px 0 rgba(26,25,22,0.03)",
            }}
          >
            <span style={{ color: TOKENS.muted }}>$</span>
            <span>
              <span style={{ color: TOKENS.text2 }}>npm install</span> @agntz/sdk
            </span>
            <span style={{ width: 1, height: 16, background: TOKENS.line, margin: "0 4px" }} />
            <span
              style={{
                color: TOKENS.muted,
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
            <Btn primary size="lg" href="/docs">
              Quickstart <ArrowIcon />
            </Btn>
            <Btn size="lg" icon={<GithubIcon />} href="https://github.com/aparry3/agntz">
              View on GitHub <ExternalIcon />
            </Btn>
          </Row>

          <Row
            gap={20}
            style={{
              marginTop: 8,
              alignItems: "center",
              color: TOKENS.text2,
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            {["YAML in, agent out", "Your existing APIs", "Local · Hosted · Self-host"].map(
              (t) => (
                <Row key={t} gap={6} style={{ alignItems: "center" }}>
                  <span style={{ color: a.fg, display: "inline-flex" }}>
                    <CheckIcon />
                  </span>
                  {t}
                </Row>
              ),
            )}
          </Row>
        </Stack>

        <Stack gap={0} style={{ position: "relative" }}>
          <div
            style={{
              background: TOKENS.surface,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 12,
              overflow: "hidden",
              boxShadow:
                "0 24px 60px rgba(26,25,22,0.10), 0 4px 14px rgba(26,25,22,0.05)",
            }}
          >
            <Row
              style={{
                alignItems: "center",
                justifyContent: "space-between",
                background: TOKENS.warm,
                borderBottom: `1px solid ${TOKENS.line}`,
              }}
            >
              <Row gap={0}>
                {[
                  { id: "yaml" as const, label: "agent.yaml" },
                  { id: "runner" as const, label: "runner.ts" },
                ].map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => setTab(tb.id)}
                    style={{
                      padding: "11px 18px",
                      border: 0,
                      background: tab === tb.id ? TOKENS.surface : "transparent",
                      borderRight: `1px solid ${TOKENS.line}`,
                      borderBottom:
                        tab === tb.id ? `2px solid ${TOKENS.ink}` : "2px solid transparent",
                      marginBottom: -1,
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: tab === tb.id ? TOKENS.ink : TOKENS.muted,
                      fontWeight: tab === tb.id ? 600 : 400,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <CodeIcon />
                    {tb.label}
                  </button>
                ))}
              </Row>
              <button
                type="button"
                onClick={copyActive}
                aria-label={`Copy ${tab === "yaml" ? "agent.yaml" : "runner.ts"} to clipboard`}
                style={{
                  marginRight: 8,
                  padding: "6px 10px",
                  border: 0,
                  background: "transparent",
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: copied ? ACCENTS.green.fg : TOKENS.muted,
                  cursor: "pointer",
                  borderRadius: 4,
                  transition: "color 120ms ease",
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
            </Row>

            <pre
              style={{
                margin: 0,
                padding: "16px 18px",
                fontFamily: "var(--mono)",
                fontSize: 12.5,
                lineHeight: 1.65,
                color: TOKENS.ink,
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                minHeight: 350,
              }}
            >
              <code>{tab === "yaml" ? highlightYAML(HERO_YAML) : highlightTS(HERO_RUNNER)}</code>
            </pre>

            <Row
              style={{
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                borderTop: `1px solid ${TOKENS.line}`,
                background: TOKENS.warm,
              }}
            >
              <Row gap={8} style={{ alignItems: "center" }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: 99, background: ACCENTS.green.fg }}
                />
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.text2 }}>
                  {tab === "yaml" ? "valid · ready to run" : "session resumable"}
                </span>
              </Row>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
                {tab === "yaml" ? "weather-bot.yaml" : "@agntz/sdk"}
              </span>
            </Row>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: "12px 16px",
              border: `1px dashed ${a.line}`,
              borderRadius: 8,
              background: a.bg + "70",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ color: a.fg, display: "inline-flex" }}>
              <SparkIcon />
            </span>
            <span style={{ fontSize: 13, color: TOKENS.ink, lineHeight: 1.45 }}>
              The YAML <i>is</i> the agent. No wiring, no compose, no loop to author —{" "}
              <b style={{ fontWeight: 600 }}>the runtime runs it.</b>
            </span>
          </div>
        </Stack>
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
