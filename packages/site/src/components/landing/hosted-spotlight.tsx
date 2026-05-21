import type { CSSProperties, ReactNode } from "react";
import { ACCENTS, type AccentName, TOKENS } from "./tokens";
import { Btn, Card, Code, H1, H2, Lede, Pill, Row, Section, Stack } from "./primitives";
import { ArrowIcon, BranchIcon, CheckIcon, CubeIcon, ExternalIcon, SparkIcon } from "./icons";

export function HostedSpotlight({ accent = "blue" }: { accent?: AccentName }) {
  return (
    <Section id="hosted" kicker="Hosted spotlight">
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
          Iterate
          <br />
          <span style={{ color: TOKENS.muted }}>without rewrites.</span>
        </H2>
        <Lede>
          When you&apos;re ready for collaboration, versioning, and visual debugging — your YAML
          moves with you, unchanged. Same agent file, same runtime, more surface.
        </Lede>
      </div>

      <BuilderStage accent={accent} />

      <Row gap={12} style={{ marginTop: 40, alignItems: "center", flexWrap: "wrap" }}>
        <Btn primary>
          See hosted <ArrowIcon />
        </Btn>
        <Btn>
          Watch the 90-second tour <ExternalIcon />
        </Btn>
        <span style={{ fontSize: 13, color: TOKENS.muted, marginLeft: 8 }}>
          Free tier · no credit card · same YAML works locally.
        </span>
      </Row>
    </Section>
  );
}

function BuilderStage({ accent }: { accent: AccentName }) {
  return (
    <Card
      style={{
        overflow: "hidden",
        padding: 0,
        boxShadow: "0 32px 80px rgba(26,25,22,0.14), 0 6px 18px rgba(26,25,22,0.06)",
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
          <span style={{ width: 10, height: 10, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: TOKENS.line }} />
          <span style={{ width: 10, height: 10, borderRadius: 99, background: TOKENS.line }} />
        </Row>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: TOKENS.text2 }}>
          agntz.co/agents/weather-bot
        </span>
        <span style={{ width: 30 }} />
      </Row>

      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr 240px",
            minWidth: 1040,
            minHeight: 800,
            background: TOKENS.surface2,
          }}
        >
          <BuilderRail accent={accent} />
          <BuilderMain accent={accent} />
          <BuilderInspector accent={accent} />
        </div>
      </div>

      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 16px",
          borderTop: `1px solid ${TOKENS.line}`,
          background: TOKENS.warm,
        }}
      >
        <Row
          gap={10}
          style={{
            alignItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: TOKENS.text2,
          }}
        >
          <span style={{ color: ACCENTS.green.fg, display: "inline-flex" }}>
            <CheckIcon />
          </span>
          <span>Validates</span>
          <span style={{ color: TOKENS.muted }}>·</span>
          <span>1 LLM call · 1 tool call</span>
          <span style={{ color: TOKENS.muted }}>·</span>
          <span>est. 1.4s</span>
          <span style={{ color: TOKENS.muted }}>·</span>
          <span>~$0.002/run</span>
        </Row>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.muted }}>
          Press{" "}
          <span
            style={{
              padding: "1px 6px",
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 3,
              color: TOKENS.text2,
              background: TOKENS.surface,
            }}
          >
            ?
          </span>{" "}
          for shortcuts
        </span>
      </Row>
    </Card>
  );
}

function BuilderRail({ accent }: { accent: AccentName }) {
  const a = ACCENTS[accent];
  type Item = [label: string, active: boolean, count: number | null];
  type Group = { h: string; items: Item[] };
  const groups: Group[] = [
    {
      h: "BUILD",
      items: [
        ["Agents", true, 3],
        ["Skills", false, 5],
      ],
    },
    {
      h: "OBSERVE",
      items: [
        ["Runs", false, 1284],
        ["Traces", false, null],
        ["Logs", false, null],
        ["Sessions", false, 142],
      ],
    },
    { h: "CONFIGURE", items: [] },
  ];

  return (
    <Stack
      gap={0}
      style={{
        borderRight: `1px solid ${TOKENS.line}`,
        background: TOKENS.surface,
        padding: "14px 10px 10px",
      }}
    >
      <Stack
        gap={4}
        style={{
          padding: "4px 8px 12px",
          borderBottom: `1px dashed ${TOKENS.line}`,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 9.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKENS.muted,
          }}
        >
          workspace
        </span>
        <Row gap={8} style={{ alignItems: "center", padding: "6px 0" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 5,
              background: TOKENS.ink,
              color: TOKENS.bg,
              fontFamily: "var(--mono)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            a
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>agntz</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.muted }}>▾</span>
        </Row>
      </Stack>

      <Row
        gap={6}
        style={{
          alignItems: "center",
          padding: "8px 10px",
          background: TOKENS.surface2,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 6,
          marginBottom: 14,
        }}
      >
        <span style={{ color: TOKENS.muted, fontSize: 11 }}>⌕</span>
        <span style={{ fontSize: 12, color: TOKENS.muted, flex: 1 }}>search…</span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            padding: "1px 5px",
            border: `1px solid ${TOKENS.line}`,
            borderRadius: 3,
            color: TOKENS.muted,
            background: TOKENS.surface,
          }}
        >
          ⌘K
        </span>
      </Row>

      {groups.map((g) => (
        <Stack key={g.h} gap={2} style={{ marginBottom: 14 }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TOKENS.muted,
              padding: "2px 8px 4px",
            }}
          >
            {g.h}
          </span>
          {g.items.map(([label, active, count]) => (
            <Row
              key={label}
              gap={8}
              style={{
                padding: "7px 10px",
                borderRadius: 6,
                background: active ? a.bg : "transparent",
                border: `1px solid ${active ? a.line : "transparent"}`,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 99,
                  background: active ? a.fg : TOKENS.muted,
                  opacity: active ? 1 : 0.5,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: active ? a.fg : TOKENS.text2,
                  fontWeight: active ? 600 : 400,
                  flex: 1,
                }}
              >
                {label}
              </span>
              {count != null && (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: active ? a.fg : TOKENS.muted,
                  }}
                >
                  {count}
                </span>
              )}
            </Row>
          ))}
        </Stack>
      ))}

      <span style={{ flex: 1 }} />

      <Stack gap={0} style={{ borderTop: `1px dashed ${TOKENS.line}`, paddingTop: 10 }}>
        <Row gap={8} style={{ alignItems: "center", padding: "4px 8px 8px" }}>
          <Pill mono style={{ padding: "2px 6px", fontSize: 9.5 }}>
            system agents
          </Pill>
          <span style={{ flex: 1 }} />
          <Pill accent="amber" mono style={{ padding: "2px 6px", fontSize: 9.5 }}>
            admin
          </Pill>
        </Row>
        <Row gap={8} style={{ alignItems: "center", padding: "8px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 99,
              background: TOKENS.warm,
              border: `1px solid ${TOKENS.line}`,
              fontFamily: "var(--mono)",
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            A
          </span>
          <Stack gap={0} style={{ flex: 1, overflow: "hidden" }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>Aaron Parry</span>
            <span
              style={{
                fontSize: 10.5,
                color: TOKENS.muted,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              aaron@agntz.co
            </span>
          </Stack>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: TOKENS.muted }}>···</span>
        </Row>
      </Stack>
    </Stack>
  );
}

function BuilderMain({ accent }: { accent: AccentName }) {
  type Tab = { id: string; label: string; ic: string; active: boolean };
  const tabs: Tab[] = [
    { id: "build", label: "Build", ic: "▦", active: true },
    { id: "yaml", label: "YAML", ic: "</>", active: false },
    { id: "instruction", label: "Instruction", ic: "✦", active: false },
    { id: "both", label: "Both", ic: "◉", active: false },
  ];

  return (
    <Stack gap={0} style={{ background: TOKENS.surface2 }}>
      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px 6px",
        }}
      >
        <Row gap={6} style={{ alignItems: "center", fontSize: 12.5, color: TOKENS.text2 }}>
          <a href="#" style={{ color: TOKENS.text2, textDecoration: "none" }}>
            agntz
          </a>
          <span style={{ color: TOKENS.muted }}>›</span>
          <a href="#" style={{ color: TOKENS.text2, textDecoration: "none" }}>
            Agents
          </a>
          <span style={{ color: TOKENS.muted }}>›</span>
          <span style={{ color: TOKENS.ink, fontWeight: 500 }}>weather-bot</span>
        </Row>
        <Row gap={6} style={{ alignItems: "center" }}>
          <Btn size="sm" ghost style={{ color: TOKENS.text2 }}>
            Delete
          </Btn>
          <Btn size="sm" icon={<BranchIcon />}>
            History
          </Btn>
          <Btn size="sm" icon={<SparkIcon />}>
            Playground
          </Btn>
          <Btn primary size="sm">
            Save
          </Btn>
        </Row>
      </Row>

      <div style={{ padding: "4px 24px 8px" }}>
        <H1 size={28} style={{ fontWeight: 500, letterSpacing: "-0.02em" }}>
          weather-bot
        </H1>
      </div>

      <Row gap={8} style={{ alignItems: "center", padding: "4px 24px 14px", flexWrap: "wrap" }}>
        <Pill mono style={{ background: TOKENS.surface }}>
          weather-bot
          <span style={{ color: TOKENS.muted, marginLeft: 6 }}>⎘</span>
        </Pill>
        <Pill mono style={{ background: TOKENS.surface }}>
          @latest
          <span style={{ color: TOKENS.muted, marginLeft: 6 }}>⎘</span>
        </Pill>
        <Pill accent={accent} mono>
          LLM
        </Pill>
        <Pill accent="green" dot mono>
          Ready
        </Pill>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: TOKENS.muted,
            marginLeft: 4,
          }}
        >
          saved 15:42 today
        </span>
      </Row>

      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 12px",
          borderBottom: `1px solid ${TOKENS.line}`,
        }}
      >
        <Row gap={4} style={{ alignItems: "center" }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TOKENS.muted,
              marginRight: 10,
            }}
          >
            view
          </span>
          {tabs.map((t) => (
            <Row
              key={t.id}
              gap={6}
              style={{
                padding: "6px 12px",
                background: t.active ? TOKENS.warm : "transparent",
                border: `1px solid ${t.active ? TOKENS.line : "transparent"}`,
                borderRadius: 6,
                alignItems: "center",
                fontSize: 12.5,
                fontWeight: t.active ? 600 : 400,
                color: t.active ? TOKENS.ink : TOKENS.text2,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: t.active ? TOKENS.ink : TOKENS.muted,
                }}
              >
                {t.ic}
              </span>
              {t.label}
            </Row>
          ))}
        </Row>
        <Row
          gap={10}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: TOKENS.muted,
            alignItems: "center",
          }}
        >
          <span>1 input</span>
          <span>·</span>
          <span>1 output</span>
          <span>·</span>
          <span>0 examples</span>
        </Row>
      </Row>

      <BuilderCanvas accent={accent} />
    </Stack>
  );
}

function BuilderInspector({ accent }: { accent: AccentName }) {
  const a = ACCENTS[accent];
  type Sect = { h: string; v: string; open: boolean };
  const sections: Sect[] = [
    { h: "Agent settings", v: "model · instruction", open: false },
    { h: "Tools", v: "1 attached", open: true },
    { h: "Output schema", v: "0 fields", open: false },
    { h: "Examples", v: "0 pinned", open: false },
    { h: "Advanced", v: "", open: false },
  ];

  return (
    <Stack
      gap={0}
      style={{
        borderLeft: `1px solid ${TOKENS.line}`,
        background: TOKENS.surface,
        padding: "20px 18px",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: TOKENS.muted,
          marginBottom: 8,
        }}
      >
        root agent
      </span>
      <Row
        gap={8}
        style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}
      >
        <Row gap={8} style={{ alignItems: "center" }}>
          <Pill accent={accent} mono style={{ padding: "3px 8px" }}>
            LLM
          </Pill>
          <span style={{ fontSize: 14, fontWeight: 600 }}>weather-bot</span>
        </Row>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
          weather-bot
        </span>
      </Row>

      <div style={{ borderTop: `1px solid ${TOKENS.line}`, paddingTop: 14, marginBottom: 14 }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKENS.muted,
          }}
        >
          inputs
        </span>
        <p style={{ margin: "6px 0 12px", fontSize: 11.5, color: TOKENS.text2, lineHeight: 1.5 }}>
          Fields the caller passes in. Each one is available as{" "}
          <Code>{"{{name}}"}</Code> in the instruction.
        </p>

        <Stack gap={6}>
          <Row
            gap={8}
            style={{
              alignItems: "center",
              padding: "8px 10px",
              background: TOKENS.surface2,
              border: `1px solid ${TOKENS.line}`,
              borderRadius: 6,
            }}
          >
            <span style={{ color: a.fg, display: "inline-flex" }}>
              <CubeIcon />
            </span>
            <Stack gap={0} style={{ flex: 1 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, fontWeight: 500 }}>
                message
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: TOKENS.muted }}>
                string · required
              </span>
            </Stack>
          </Row>
          <Row
            gap={6}
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 10px",
              background: TOKENS.surface2,
              border: `1px dashed ${TOKENS.line}`,
              borderRadius: 6,
              color: a.fg,
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            + Add input
          </Row>
        </Stack>
      </div>

      <div style={{ borderTop: `1px solid ${TOKENS.line}`, paddingTop: 14, marginBottom: 14 }}>
        <Row
          gap={4}
          style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: TOKENS.muted,
            }}
          >
            available state
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: a.fg,
              cursor: "pointer",
            }}
          >
            click to insert →
          </span>
        </Row>
        <Row gap={6} style={{ flexWrap: "wrap" }}>
          <Pill
            mono
            style={{
              padding: "3px 8px",
              background: a.bg,
              color: a.fg,
              borderColor: a.line,
            }}
          >
            {"{{message}}"}
          </Pill>
        </Row>
      </div>

      <Stack gap={0} style={{ borderTop: `1px solid ${TOKENS.line}` }}>
        {sections.map((s) => (
          <Row
            key={s.h}
            gap={6}
            style={{
              alignItems: "center",
              padding: "12px 0",
              borderBottom: `1px dashed ${TOKENS.line}`,
            }}
          >
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: TOKENS.muted }}>
              {s.open ? "▾" : "▸"}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: s.open ? 600 : 500,
                color: TOKENS.ink,
                flex: 1,
              }}
            >
              {s.h}
            </span>
            {s.v && (
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
                {s.v}
              </span>
            )}
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}

function BuilderCanvas({ accent }: { accent: AccentName }) {
  const a = ACCENTS[accent];
  return (
    <div
      style={{
        flex: 1,
        position: "relative",
        background: `radial-gradient(circle at center, ${TOKENS.line} 1px, transparent 1px)`,
        backgroundSize: "20px 20px",
        backgroundColor: TOKENS.surface2,
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <Row
        gap={0}
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          background: TOKENS.surface2,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 6,
          overflow: "hidden",
          boxShadow: "0 1px 0 rgba(26,25,22,0.04)",
        }}
      >
        {[
          { l: "−", w: 32 },
          { l: "100%", w: 56 },
          { l: "+", w: 32 },
        ].map((s) => (
          <span
            key={s.l}
            style={{
              padding: "6px 0",
              width: s.w,
              textAlign: "center",
              borderRight: `1px solid ${TOKENS.line}`,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: TOKENS.text2,
              cursor: "pointer",
            }}
          >
            {s.l}
          </span>
        ))}
        <span
          style={{
            padding: "6px 12px",
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: TOKENS.text2,
            cursor: "pointer",
          }}
        >
          Fit
        </span>
      </Row>

      <Row
        gap={6}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          padding: "6px 12px",
          background: TOKENS.surface2,
          border: `1px solid ${TOKENS.line}`,
          borderRadius: 6,
          fontSize: 12,
          color: TOKENS.ink,
          cursor: "pointer",
          alignItems: "center",
          boxShadow: "0 1px 0 rgba(26,25,22,0.04)",
        }}
      >
        <span style={{ color: a.fg, fontFamily: "var(--mono)" }}>+</span>
        Convert to pipeline
      </Row>

      <svg
        viewBox="0 0 800 660"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <marker
            id="bs-arrow-down"
            viewBox="0 0 10 10"
            refX="5"
            refY="9"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,0 L5,10 z" fill={a.fg} />
          </marker>
        </defs>
        <line
          x1="400"
          y1="138"
          x2="400"
          y2="226"
          stroke={a.fg}
          strokeWidth="1.5"
          markerEnd="url(#bs-arrow-down)"
        />
        <line
          x1="400"
          y1="470"
          x2="400"
          y2="538"
          stroke={a.fg}
          strokeWidth="1.5"
          markerEnd="url(#bs-arrow-down)"
        />
      </svg>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 80,
          transform: "translateX(-50%)",
          width: 200,
          padding: "16px 16px 18px",
          border: `1.5px dashed ${TOKENS.line}`,
          borderRadius: 8,
          textAlign: "center",
          background: "rgba(255,255,255,0.4)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKENS.muted,
          }}
        >
          input
        </span>
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: TOKENS.text2,
          }}
        >
          message
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 230,
          transform: "translateX(-50%)",
          width: 320,
          background: TOKENS.warm,
          border: `1.5px solid ${TOKENS.line}`,
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(26,25,22,0.05)",
          overflow: "hidden",
        }}
      >
        <Row
          gap={8}
          style={{
            alignItems: "center",
            padding: "12px 14px",
            borderBottom: `1px solid ${TOKENS.line2}`,
          }}
        >
          <Pill accent={accent} mono style={{ padding: "3px 8px" }}>
            LLM
          </Pill>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>weather-bot</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.muted }}>
            weather-bot
          </span>
          <span style={{ flex: 1 }} />
          <Pill accent="amber" mono style={{ padding: "2px 6px", fontSize: 9.5 }}>
            EDITING
          </Pill>
        </Row>
        <div style={{ padding: "14px 16px 12px" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: TOKENS.ink,
              lineHeight: 1.6,
              whiteSpace: "pre-line",
            }}
          >
            {"You are a friendly weather assistant.\nWhen asked about a city, look up the\nforecast and reply in plain language."}
          </p>
        </div>
        <Row
          gap={8}
          style={{
            alignItems: "center",
            padding: "10px 14px",
            borderTop: `1px solid ${TOKENS.line2}`,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: TOKENS.text2,
          }}
        >
          <span style={{ color: a.fg }}>✦</span>
          <span>anthropic</span>
          <span style={{ color: TOKENS.muted }}>·</span>
          <span>claude-sonnet-4-6</span>
        </Row>
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 540,
          transform: "translateX(-50%)",
          width: 240,
          padding: "14px 16px",
          border: `1.5px dashed ${TOKENS.line}`,
          borderRadius: 8,
          textAlign: "center",
          background: "rgba(255,255,255,0.4)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: TOKENS.muted,
          }}
        >
          output
        </span>
        <div
          style={{
            marginTop: 6,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: TOKENS.text2,
          }}
        >
          &quot;Lisbon is 21°C and sunny…&quot;
        </div>
      </div>

      <FloatingPanel
        style={{ bottom: 170, left: 130, width: 240 }}
        title="weather-bot.yaml"
        tag="source"
      >
        <pre
          style={{
            margin: 0,
            fontFamily: "var(--mono)",
            fontSize: 11,
            lineHeight: 1.6,
            color: TOKENS.ink,
            whiteSpace: "pre",
            overflow: "hidden",
          }}
        >
          <span style={{ color: "#7e3b8c" }}>id:</span> weather-bot{"\n"}
          <span style={{ color: "#7e3b8c" }}>kind:</span> llm{"\n"}
          <span style={{ color: "#7e3b8c" }}>model:</span>
          {"\n  "}
          <span style={{ color: "#7e3b8c" }}>name:</span> claude-sonnet-4-6{"\n"}
          <span style={{ color: "#7e3b8c" }}>tools:</span>
          {"\n  - "}
          <span style={{ color: "#7e3b8c" }}>kind:</span> http{"\n    "}
          <span style={{ color: "#7e3b8c" }}>name:</span> get_forecast
        </pre>
      </FloatingPanel>

      <FloatingPanel
        style={{ bottom: 90, left: 75, width: 280 }}
        title="Versions · 4"
        tag="history"
      >
        <Stack gap={2}>
          {[
            { ts: "15:42 today", note: "soften greeting copy", latest: true, pinned: false },
            { ts: "11:08 today", note: "fallback for missing city", latest: false, pinned: false },
            { ts: "May 15", note: "add get_forecast tool", latest: false, pinned: true },
          ].map((v, i, arr) => (
            <Stack
              key={v.ts}
              gap={4}
              style={{
                padding: "7px 0",
                borderBottom: i < arr.length - 1 ? `1px dashed ${TOKENS.line2}` : "none",
              }}
            >
              <Row gap={6} style={{ alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: TOKENS.text2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {v.ts}
                </span>
                <span style={{ flex: 1 }} />
                {v.pinned && (
                  <Pill accent="green" dot mono style={{ padding: "2px 6px", fontSize: 9.5 }}>
                    pinned
                  </Pill>
                )}
                {v.latest && (
                  <Pill accent={accent} dot mono style={{ padding: "2px 6px", fontSize: 9.5 }}>
                    @latest
                  </Pill>
                )}
              </Row>
              <span style={{ fontSize: 10.5, color: TOKENS.ink, lineHeight: 1.4 }}>{v.note}</span>
            </Stack>
          ))}
        </Stack>
      </FloatingPanel>

      <FloatingPanel
        style={{ bottom: 20, left: 20, width: 380 }}
        title="trc_01H8K2X9PY42"
        tag="last run"
        tagAccent="green"
      >
        <Stack gap={5}>
          <Row
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              color: TOKENS.muted,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ flex: 1 }}>span</span>
            <span style={{ width: 44, textAlign: "right" }}>1.84s</span>
          </Row>
          {[
            { d: 0, v: "weather-bot", t: "1.84s", o: 0, w: 100, c: TOKENS.ink },
            { d: 1, v: "claude-sonnet", t: "612ms", o: 0, w: 33, c: ACCENTS.purple.fg },
            { d: 1, v: "get_forecast", t: "84ms", o: 34, w: 5, c: ACCENTS.amber.fg },
            { d: 1, v: "claude-sonnet", t: "933ms", o: 40, w: 50, c: ACCENTS.purple.fg },
          ].map((s, i) => (
            <Row
              key={i}
              gap={6}
              style={{ alignItems: "center", fontFamily: "var(--mono)", fontSize: 10 }}
            >
              <Row
                gap={4}
                style={{ alignItems: "center", width: 116, paddingLeft: s.d * 6 }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 1,
                    background: s.c,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: TOKENS.ink,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.v}
                </span>
              </Row>
              <div style={{ flex: 1, height: 7, position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: `${s.o}%`,
                    width: `${Math.max(s.w, 1)}%`,
                    top: 1,
                    bottom: 1,
                    background: s.c,
                    opacity: s.d === 0 ? 1 : 0.85,
                    borderRadius: 1.5,
                    minWidth: 2,
                  }}
                />
              </div>
              <span style={{ width: 40, textAlign: "right", color: TOKENS.text2 }}>{s.t}</span>
            </Row>
          ))}
        </Stack>
      </FloatingPanel>
    </div>
  );
}

function FloatingPanel({
  children,
  style,
  title,
  tag,
  tagAccent,
}: {
  children: ReactNode;
  style?: CSSProperties;
  title: string;
  tag?: string;
  tagAccent?: AccentName;
}) {
  return (
    <div
      style={{
        position: "absolute",
        background: "rgba(251, 249, 244, 0.94)",
        backdropFilter: "saturate(140%) blur(8px)",
        WebkitBackdropFilter: "saturate(140%) blur(8px)",
        border: `1px solid ${TOKENS.line}`,
        borderRadius: 10,
        boxShadow: "0 18px 40px rgba(26,25,22,0.14), 0 4px 10px rgba(26,25,22,0.06)",
        overflow: "hidden",
        ...style,
      }}
    >
      <Row
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: `1px solid ${TOKENS.line2}`,
          background: "rgba(244,241,233,0.4)",
        }}
      >
        <span
          style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: TOKENS.ink, fontWeight: 500 }}
        >
          {title}
        </span>
        {tag && (
          <Pill
            accent={tagAccent}
            dot={tagAccent === "green"}
            mono
            style={{ padding: "2px 7px", fontSize: 9.5 }}
          >
            {tag}
          </Pill>
        )}
      </Row>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}
