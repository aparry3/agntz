"use client";

import type { ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Card, H2, Lede, Row, Section, Stack } from "./primitives";
import { BranchIcon, CodeIcon, SparkIcon } from "./icons";
import { usePreferredLanguage } from "../language";

type Step = {
  n: number;
  kicker: string;
  title: string;
  body: string;
  icon: ReactNode;
  snippet: string[];
};

const STEPS: Step[] = [
  {
    n: 1,
    kicker: "Define",
    title: "Write the YAML.",
    body: "One file describes the model, instruction, tools, and auth. Lives in your repo next to everything else you ship.",
    icon: <CodeIcon />,
    snippet: [
      "id: support-agent",
      "kind: llm",
      "model:",
      "  name: claude-sonnet-4-6",
      "tools: [...]",
    ],
  },
  {
    n: 2,
    kicker: "Run",
    title: "One call.",
    body: "Hand the runtime an agent id and an input. It drives the loop — tool calls, retries, context windowing, sessions.",
    icon: <SparkIcon />,
    snippet: [
      "const { output } =",
      "  await client.agents.run({",
      "    agentId: 'support-agent',",
      "    input: '...',",
      "  });",
    ],
  },
  {
    n: 3,
    kicker: "Iterate",
    title: "Edit. Re-run.",
    body: "Tweak the YAML, commit it, ship it. Agents review in PRs and deploy with the rest of your config.",
    icon: <BranchIcon />,
    snippet: [
      "$ git diff support-agent.yaml",
      "- temperature: 0.7",
      "+ temperature: 0.3",
      "$ git commit -m 'tune'",
    ],
  },
];

export function TheLoop({ accent = "blue" }: { accent?: AccentName }) {
  const a = ACCENTS[accent];
  const { language } = usePreferredLanguage();
  const steps = STEPS.map((step) =>
    step.n === 2 && language === "python"
      ? {
          ...step,
          snippet: [
            "result = client.agents.run(",
            "    agent_id='support-agent',",
            "    input='...',",
            ")",
          ],
        }
      : step,
  );

  return (
    <Section id="loop" kicker="The loop">
      <div
        style={{
          marginBottom: 56,
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: 64,
          alignItems: "end",
        }}
      >
        <H2 size={56} style={{ letterSpacing: "-0.035em" }}>
          Edit YAML. Run. Done.
        </H2>
        <Lede>
          Your agent definition is a file. Change it, version it, deploy it like any other config.
          No framework migration. No glue code between iterations.
        </Lede>
      </div>

      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 32,
            left: "12%",
            right: "12%",
            height: 1,
            background: `repeating-linear-gradient(90deg, ${TOKENS.line} 0 6px, transparent 6px 12px)`,
            zIndex: 0,
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 20,
            position: "relative",
          }}
        >
          {steps.map((s) => (
            <Card
              key={s.n}
              style={{
                padding: 26,
                background: TOKENS.surface2,
                borderColor: TOKENS.line,
                color: TOKENS.ink,
                display: "flex",
                flexDirection: "column",
                gap: 18,
                minHeight: 320,
              }}
            >
              <Row gap={12} style={{ alignItems: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: 99,
                    background: TOKENS.warm,
                    border: `1px solid ${TOKENS.line}`,
                    color: TOKENS.ink,
                    fontFamily: "var(--mono)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {s.n}
                </span>
                <Stack gap={2}>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: TOKENS.muted,
                    }}
                  >
                    step 0{s.n}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      color: TOKENS.ink,
                    }}
                  >
                    {s.kicker}
                  </span>
                </Stack>
              </Row>

              <H2 size={26} style={{ fontWeight: 500, lineHeight: 1.15 }}>
                {s.title}
              </H2>

              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: TOKENS.text2,
                  textWrap: "pretty",
                  flex: 1,
                }}
              >
                {s.body}
              </p>

              <pre
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  fontFamily: "var(--mono)",
                  fontSize: 11.5,
                  lineHeight: 1.65,
                  color: TOKENS.text2,
                  background: TOKENS.surface,
                  border: `1px solid ${TOKENS.line}`,
                  borderRadius: 6,
                  whiteSpace: "pre",
                  overflow: "hidden",
                }}
              >
                {s.snippet.join("\n")}
              </pre>
            </Card>
          ))}
        </div>
      </div>

      <Row
        gap={14}
        style={{
          marginTop: 32,
          padding: "16px 20px",
          background: TOKENS.surface2,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <span style={{ color: a.fg, display: "inline-flex" }}>
          <BranchIcon />
        </span>
        <span style={{ fontSize: 14, color: TOKENS.text2, flex: 1, lineHeight: 1.5 }}>
          <b style={{ color: TOKENS.ink, fontWeight: 600 }}>Agents are config, not code.</b> They
          live in git, review in PRs, and deploy with your stack — or skip the file and build them
          in the hosted UI.
        </span>
        <a
          href="#hosted"
          style={{
            color: a.fg,
            fontSize: 13.5,
            textDecoration: "none",
            fontWeight: 500,
            borderBottom: `1px solid ${a.line}`,
            paddingBottom: 2,
            whiteSpace: "nowrap",
          }}
        >
          See the visual builder →
        </a>
      </Row>
    </Section>
  );
}
