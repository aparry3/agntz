import type { SpanStatus, RunStatus } from "@agntz/core";

type StatusValue = SpanStatus | RunStatus;

const STYLES: Record<StatusValue, { dot: string; label: string; text: string }> = {
  // SpanStatus + shared values
  running:   { dot: "bg-blue-500",    label: "Running",   text: "text-blue-700" },
  ok:        { dot: "bg-emerald-500", label: "OK",        text: "text-emerald-700" },
  error:     { dot: "bg-rose-500",    label: "Error",     text: "text-rose-700" },
  cancelled: { dot: "bg-zinc-400",    label: "Cancelled", text: "text-zinc-500" },
  // RunStatus-only
  pending:   { dot: "bg-blue-300",    label: "Pending",   text: "text-blue-600" },
  draining:  { dot: "bg-blue-400",    label: "Draining",  text: "text-blue-600" },
  completed: { dot: "bg-emerald-500", label: "Completed", text: "text-emerald-700" },
  failed:    { dot: "bg-rose-500",    label: "Failed",    text: "text-rose-700" },
};

export function StatusBadge({ status }: { status: StatusValue }) {
  const s = STYLES[status];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} ${
          status === "running" || status === "pending" || status === "draining"
            ? "animate-pulse"
            : ""
        }`}
      />
      {s.label}
    </span>
  );
}
