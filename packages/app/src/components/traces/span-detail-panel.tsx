"use client";

import type { Span } from "@agntz/core";
import { JsonView } from "@/components/json-view";
import { KindIcon } from "@/components/kind-icon";
import { StatusBadge } from "@/components/status-badge";

export function SpanDetailPanel({ span }: { span: Span | null }) {
  if (!span) {
    return (
      <div className="flex h-full items-center justify-center rounded-[1.5rem] border border-stone-200 bg-white p-4 text-sm text-zinc-500 shadow-sm">
        Select a span to see details.
      </div>
    );
  }

  const attrs = span.attributes ?? {};
  const tokens = readTokens(attrs);
  const model = typeof attrs["agent.model"] === "string" ? (attrs["agent.model"] as string) : null;
  const finishReason =
    typeof attrs["agent.finish_reason"] === "string"
      ? (attrs["agent.finish_reason"] as string)
      : null;
  const toolName =
    typeof attrs["agent.tool.name"] === "string" ? (attrs["agent.tool.name"] as string) : null;

  return (
    <div className="rounded-[1.5rem] border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <KindIcon kind={span.kind} />
            <span className="font-mono text-sm font-medium text-zinc-900">{span.name}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-500">{span.spanId}</div>
        </div>
        <StatusBadge status={span.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <Stat label="Started" value={new Date(span.startedAt).toLocaleString()} />
        <Stat label="Duration" value={span.durationMs === null ? "—" : `${span.durationMs}ms`} />
        {model && <Stat label="Model" value={model} />}
        {finishReason && <Stat label="Finish" value={finishReason} />}
        {toolName && <Stat label="Tool" value={toolName} />}
        {tokens && (
          <>
            <Stat label="Prompt tokens" value={tokens.prompt.toLocaleString()} />
            <Stat label="Completion" value={tokens.completion.toLocaleString()} />
          </>
        )}
        {span.costUsd !== null && <Stat label="Cost" value={`$${span.costUsd.toFixed(6)}`} />}
        {span.error && <Stat label="Error" value={span.error} />}
      </dl>

      {Object.keys(attrs).length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            Attributes
          </div>
          <JsonView data={attrs} />
        </div>
      )}

      {span.events.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            Events
          </div>
          <ul className="space-y-1 text-xs">
            {span.events.map((e, i) => (
              <li key={i} className="font-mono">
                <span className="text-zinc-500">{e.ts}</span> {e.name}
                {e.data !== undefined && (
                  <div className="ml-4">
                    <JsonView data={e.data} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-mono text-zinc-900">{value}</dd>
    </>
  );
}

function readTokens(attrs: Record<string, unknown>): { prompt: number; completion: number } | null {
  const prompt = attrs["agent.tokens.prompt"];
  const completion = attrs["agent.tokens.completion"];
  if (typeof prompt === "number" && typeof completion === "number") {
    return { prompt, completion };
  }
  return null;
}
