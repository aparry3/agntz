"use client";

import { useState } from "react";
import type { Span, SpanKind, SpanStatus } from "@agntz/core";
import { JsonView } from "@/components/json-view";
import { KindChip } from "@/components/kind-icon";
import { Mono, ag } from "@/components/v3/primitives";

export function SpanDetailPanel({ span }: { span: Span | null }) {
  if (!span) {
    return (
      <div
        style={{
          background: ag.surface2,
          border: `1px solid ${ag.line}`,
          borderRadius: 5,
          padding: "60px 24px",
          textAlign: "center",
          color: ag.muted,
          fontSize: 13,
        }}
      >
        Select a span to see details.
      </div>
    );
  }

  const attrs = (span.attributes ?? {}) as Record<string, unknown>;

  const model = readString(attrs, "agent.model");
  const finishReason = readString(attrs, "agent.finish_reason");
  const toolName = readString(attrs, "agent.tool.name");
  const toolCallId = readString(attrs, "agent.tool.call.id");
  const toolError = readString(attrs, "agent.tool.error");
  const toolDurationMs = readNumber(attrs, "agent.tool.duration_ms");
  const toolCallCount = readNumber(attrs, "agent.tool_call_count");
  const agentInput = readString(attrs, "agent.input");
  const agentOutput = readString(attrs, "agent.output");
  const toolInputRaw = readString(attrs, "agent.tool.input");
  const toolOutputRaw = readString(attrs, "agent.tool.output");
  const modelPromptRaw = readString(attrs, "agent.prompt");
  const modelCompletion = readString(attrs, "agent.completion");
  const tokens = readTokens(attrs);

  return (
    <div
      style={{
        background: ag.surface2,
        border: `1px solid ${ag.line}`,
        borderRadius: 5,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "9px 14px",
          background: ag.surface,
          borderBottom: `1px solid ${ag.line}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <KindChip kind={span.kind} />
          <Mono
            size={12}
            color={ag.ink}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
            }}
          >
            {span.name}
          </Mono>
        </div>
        <StatusChip status={span.status} />
      </div>

      <div style={{ padding: "14px 16px" }}>
        <Mono size={11} color={ag.muted} style={{ display: "block", marginBottom: 14 }}>
          {span.spanId}
        </Mono>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px 16px", marginBottom: 18 }}>
          <Stat label="Started" value={new Date(span.startedAt).toLocaleString()} />
          <Stat label="Duration" value={span.durationMs === null ? "—" : `${span.durationMs}ms`} />
          {model && <Stat label="Model" value={model} />}
          {tokens && (
            <>
              <Stat label="Prompt tok" value={tokens.prompt.toLocaleString()} />
              <Stat label="Completion tok" value={tokens.completion.toLocaleString()} />
            </>
          )}
          {finishReason && <Stat label="Finish" value={finishReason} />}
          {toolCallCount !== null && <Stat label="Tool calls" value={String(toolCallCount)} />}
          {toolName && <Stat label="Tool" value={toolName} />}
          {toolCallId && <Stat label="Call id" value={toolCallId} />}
          {toolDurationMs !== null && <Stat label="Tool duration" value={`${toolDurationMs}ms`} />}
          {span.costUsd !== null && <Stat label="Cost" value={`$${span.costUsd.toFixed(6)}`} />}
          <Stat label="Kind" value={span.kind} />
          <Stat label="Parent" value={span.parentId ?? "—"} />
        </div>

        {span.error && <ErrorBanner title="Error" body={span.error} />}

        {renderIO(span.kind, {
          agentInput,
          agentOutput,
          toolInputRaw,
          toolOutputRaw,
          toolError,
          modelPromptRaw,
          modelCompletion,
        })}

        {Object.keys(attrs).length > 0 && (
          <Collapsible label="Raw attributes" defaultOpen={false}>
            <div
              style={{
                background: ag.bg,
                border: `1px solid ${ag.line2}`,
                borderRadius: 4,
                padding: "8px 10px",
                marginTop: 6,
              }}
            >
              <JsonView data={attrs} />
            </div>
          </Collapsible>
        )}

        {span.events.length > 0 && (
          <>
            <SectionLabel>Events</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {span.events.map((e, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 14,
                    padding: "6px 0",
                    borderBottom: i === span.events.length - 1 ? "none" : `1px dashed ${ag.line2}`,
                  }}
                >
                  <Mono size={10.5} color={ag.muted} style={{ flex: "0 0 auto" }}>
                    {e.ts}
                  </Mono>
                  <Mono size={11.5} color={ag.ink}>
                    {e.name}
                  </Mono>
                  {e.data !== undefined && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <JsonView data={e.data} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function renderIO(
  kind: SpanKind,
  io: {
    agentInput: string | null;
    agentOutput: string | null;
    toolInputRaw: string | null;
    toolOutputRaw: string | null;
    toolError: string | null;
    modelPromptRaw: string | null;
    modelCompletion: string | null;
  },
) {
  if (kind === "run" || kind === "invoke") {
    if (!io.agentInput && !io.agentOutput) return null;
    return (
      <>
        <SectionLabel>Input · Output</SectionLabel>
        <IOGrid>
          <IOPanel title="Input" body={io.agentInput} placeholder="(not recorded)" />
          <IOPanel title="Output" body={io.agentOutput} placeholder="(not recorded)" />
        </IOGrid>
      </>
    );
  }
  if (kind === "model") {
    return (
      <>
        <SectionLabel>Prompt · Completion</SectionLabel>
        <IOGrid>
          <IOPanel
            title="Prompt"
            body={prettyJsonString(io.modelPromptRaw)}
            placeholder="(prompt not recorded — set recordIO on the tracer)"
            mono
          />
          <IOPanel
            title="Completion"
            body={io.modelCompletion}
            placeholder="(completion not recorded)"
            mono
          />
        </IOGrid>
      </>
    );
  }
  if (kind === "tool") {
    if (!io.toolInputRaw && !io.toolOutputRaw && !io.toolError) return null;
    return (
      <>
        <SectionLabel>Tool call</SectionLabel>
        <IOGrid>
          <IOPanel
            title="Args"
            body={prettyJsonString(io.toolInputRaw)}
            placeholder="(none)"
            mono
          />
          <IOPanel
            title={io.toolError ? "Error" : "Result"}
            body={io.toolError ?? prettyJsonString(io.toolOutputRaw)}
            placeholder="(no result)"
            mono
            tone={io.toolError ? "error" : "default"}
          />
        </IOGrid>
      </>
    );
  }
  return null;
}

function IOGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
      {children}
    </div>
  );
}

function IOPanel({
  title,
  body,
  placeholder,
  mono = false,
  tone = "default",
}: {
  title: string;
  body: string | null;
  placeholder?: string;
  mono?: boolean;
  tone?: "default" | "error";
}) {
  const dim = !body;
  const displayBody = body ?? placeholder ?? "";
  const headBg = tone === "error" ? "#F8E8E8" : ag.surface;
  const headFg = tone === "error" ? ag.danger : ag.muted;
  return (
    <div
      style={{
        border: `1px solid ${ag.line}`,
        borderRadius: 4,
        overflow: "hidden",
        background: ag.bg,
        opacity: dim ? 0.65 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: headBg,
          borderBottom: `1px solid ${ag.line2}`,
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: headFg,
          fontWeight: 500,
        }}
      >
        <span>{title}</span>
        {body && <CopyButton text={body} />}
      </div>
      <div
        style={{
          padding: "10px 12px",
          fontSize: mono ? 11.5 : 12,
          lineHeight: 1.55,
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          color: dim ? ag.muted : tone === "error" ? ag.danger : ag.ink,
          maxHeight: 220,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {displayBody}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        background: "transparent",
        border: 0,
        padding: 0,
        color: ag.muted,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        textTransform: "none",
        letterSpacing: 0,
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function ErrorBanner({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: "#F8E8E8",
        border: `1px solid #E9C9CB`,
        borderRadius: 4,
        padding: "10px 12px",
        marginBottom: 18,
      }}
    >
      <SectionLabel style={{ color: ag.danger, marginTop: 0, marginBottom: 6 }}>
        {title}
      </SectionLabel>
      <Mono size={11.5} color={ag.danger} style={{ lineHeight: 1.5, display: "block", whiteSpace: "pre-wrap" }}>
        {body}
      </Mono>
    </div>
  );
}

function Collapsible({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          margin: "18px 0 0",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: ag.muted,
          fontWeight: 500,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>{open ? "▼" : "▶"}</span>
        {label}
      </button>
      {open && children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "5px 0",
        borderBottom: `1px dashed ${ag.line2}`,
        gap: 12,
      }}
    >
      <span style={{ color: ag.muted, fontSize: 11, letterSpacing: "0.04em" }}>{label}</span>
      <Mono
        size={11.5}
        color={ag.ink}
        style={{
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Mono>
    </div>
  );
}

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: ag.muted,
        fontWeight: 500,
        margin: "18px 0 8px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatusChip({ status }: { status: SpanStatus }) {
  const M: Record<SpanStatus, { bg: string; fg: string; label: string; pulse?: boolean }> = {
    ok:        { bg: ag.okBg, fg: ag.ok, label: "OK" },
    error:     { bg: "#F2DCDE", fg: ag.danger, label: "Error" },
    cancelled: { bg: ag.line2, fg: ag.text2, label: "Cancelled" },
    running:   { bg: ag.blueBg, fg: ag.blue, label: "Running", pulse: true },
  };
  const m = M[status] ?? { bg: ag.line2, fg: ag.text2, label: status };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: m.bg,
        color: m.fg,
        padding: "2px 7px",
        borderRadius: 3,
        fontSize: 10.5,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: m.fg,
          animation: m.pulse ? "agntz-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      {m.label}
    </span>
  );
}

function readString(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readNumber(attrs: Record<string, unknown>, key: string): number | null {
  const v = attrs[key];
  return typeof v === "number" ? v : null;
}

function readTokens(attrs: Record<string, unknown>): { prompt: number; completion: number } | null {
  const prompt = attrs["agent.usage.prompt_tokens"];
  const completion = attrs["agent.usage.completion_tokens"];
  if (typeof prompt === "number" && typeof completion === "number") {
    return { prompt, completion };
  }
  return null;
}

function prettyJsonString(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
