import type { SpanKind } from "@agntz/core";

const GLYPHS: Record<SpanKind, { glyph: string; color: string; label: string }> = {
  run: { glyph: "◉", color: "text-violet-600", label: "Run" },
  manifest: { glyph: "▣", color: "text-indigo-600", label: "Manifest" },
  step: { glyph: "▶", color: "text-blue-600", label: "Step" },
  invoke: { glyph: "✦", color: "text-cyan-600", label: "Invoke" },
  model: { glyph: "✺", color: "text-amber-600", label: "Model" },
  tool: { glyph: "⚙", color: "text-emerald-600", label: "Tool" },
};

export function KindIcon({ kind }: { kind: SpanKind }) {
  const g = GLYPHS[kind];
  return (
    <span
      className={`inline-block w-4 text-center font-mono ${g.color}`}
      title={g.label}
      aria-label={g.label}
    >
      {g.glyph}
    </span>
  );
}

/** Background color for a span kind, used by the Gantt bars. */
export function kindBgColor(kind: SpanKind): string {
  switch (kind) {
    case "run":
      return "bg-violet-500";
    case "manifest":
      return "bg-indigo-500";
    case "step":
      return "bg-blue-500";
    case "invoke":
      return "bg-cyan-500";
    case "model":
      return "bg-amber-500";
    case "tool":
      return "bg-emerald-500";
  }
}
