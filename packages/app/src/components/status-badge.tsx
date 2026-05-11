import type { SpanStatus } from "@agntz/core";

const STYLES: Record<SpanStatus, { dot: string; label: string; text: string }> = {
  running: { dot: "bg-blue-500", label: "Running", text: "text-blue-700" },
  ok: { dot: "bg-emerald-500", label: "OK", text: "text-emerald-700" },
  error: { dot: "bg-rose-500", label: "Error", text: "text-rose-700" },
  cancelled: { dot: "bg-zinc-400", label: "Cancelled", text: "text-zinc-500" },
};

export function StatusBadge({ status }: { status: SpanStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} ${
          status === "running" ? "animate-pulse" : ""
        }`}
      />
      {s.label}
    </span>
  );
}
