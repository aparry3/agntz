// CreateLanding — hero textarea + Build manually / Generate draft.
// Matches A_Create from the V3 prototype: minimal slim header, big writable
// description, then templates row, then a duplicate-from hint.

"use client";

import type { ReactNode } from "react";
import { I } from "@/components/v3/icons";
import { Btn, Crumbs, HR, Mono, ag } from "@/components/v3/primitives";

const TEMPLATES: Array<{ key: string; label: string; sub: string; Ic: React.ComponentType<{ size?: number }> }> = [
  { key: "blank-llm", label: "Blank LLM", sub: "Single LLM call", Ic: I.Sparkle },
  { key: "rag", label: "RAG over docs", sub: "Retrieve, then answer", Ic: I.Box },
  { key: "tool-calling", label: "Tool-calling", sub: "LLM + skills", Ic: I.Tools },
  { key: "multi-agent", label: "Multi-agent", sub: "Chain sub-agents", Ic: I.Agents },
];

export function CreateLanding({
  prompt,
  onChangePrompt,
  onGenerate,
  onBuildManually,
  onCancel,
  onPickTemplate,
  error,
  busy,
}: {
  prompt: string;
  onChangePrompt: (value: string) => void;
  onGenerate: () => void;
  onBuildManually: () => void;
  onCancel?: () => void;
  onPickTemplate?: (key: string) => void;
  error?: string | null;
  busy?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Slim header */}
      <div
        style={{
          padding: "16px 28px 14px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.bg,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Crumbs trail={["agntz", "Agents", "New"]} />
        <div style={{ flex: 1 }} />
        {onCancel && (
          <Btn variant="ghost" size="sm" style={{ color: ag.text2 }} onClick={onCancel}>
            Cancel
          </Btn>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", display: "grid", placeItems: "center", padding: "40px 32px" }}>
        <div style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Hero */}
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", color: ag.ink }}>
              New agent
            </h1>
            <div style={{ marginTop: 8, fontSize: 14, color: ag.text2, lineHeight: 1.55 }}>
              Describe what the agent should do and we&apos;ll draft a manifest, or start from a blank canvas and build it block by block.
            </div>
          </div>

          {/* Textarea */}
          <div
            style={{
              background: ag.surface2,
              border: `1px solid ${ag.line}`,
              borderRadius: 5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <textarea
              value={prompt}
              onChange={(e) => onChangePrompt(e.target.value)}
              placeholder="Describe the agent. Be specific about purpose, tone, inputs, and what success looks like."
              spellCheck={false}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onGenerate();
                }
              }}
              style={{
                width: "100%",
                minHeight: 150,
                border: 0,
                outline: 0,
                resize: "vertical",
                padding: "18px 20px",
                fontFamily: "inherit",
                fontSize: 14.5,
                color: ag.ink,
                background: "transparent",
                lineHeight: 1.55,
              }}
            />
            <HR />
            <div style={{ padding: "8px 10px 8px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <Mono color={ag.muted} size={11}>
                uses gpt-5.4 · ~2s · ⌘↵ to generate
              </Mono>
              <div style={{ flex: 1 }} />
              <Btn
                variant="secondary"
                size="md"
                icon={<I.Plus size={11} style={{ marginRight: 6 }} />}
                onClick={onBuildManually}
                disabled={busy}
              >
                Build manually
              </Btn>
              <Btn
                variant="primary"
                size="md"
                icon={<I.Sparkle size={11} style={{ marginRight: 6 }} />}
                onClick={onGenerate}
                disabled={busy || !prompt.trim()}
              >
                Generate draft
              </Btn>
            </div>
            {error && (
              <div
                style={{
                  padding: "6px 16px 10px",
                  fontSize: 11.5,
                  color: ag.danger,
                  borderTop: `1px solid ${ag.line2}`,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Templates */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <Eyebrow>Or start from</Eyebrow>
              <HR style={{ flex: 1 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onPickTemplate?.(t.key)}
                  style={{
                    padding: "12px 12px 11px",
                    border: `1px solid ${ag.line}`,
                    borderRadius: 4,
                    background: ag.surface2,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <t.Ic size={13} />
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: ag.ink, marginTop: 8 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: ag.muted, marginTop: 2 }}>{t.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, color: ag.muted, fontSize: 12 }}>
            <I.Hist size={12} />
            <span>
              Need to start from another agent?{" "}
              <span style={{ color: ag.ink, textDecoration: "underline", cursor: "pointer" }}>
                Duplicate an existing one
              </span>
              .
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: ag.muted,
        fontWeight: 500,
      }}
    >
      {children}
    </div>
  );
}
