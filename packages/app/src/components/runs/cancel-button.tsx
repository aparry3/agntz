"use client";

import { useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

export function CancelButton({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      setOpen(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:border-rose-300"
      >
        Cancel
      </button>
      <ConfirmDialog
        open={open}
        title="Cancel this run?"
        message="The run will be cancelled and the cancellation will cascade to all spawned children. This cannot be undone."
        confirmLabel="Yes, cancel run"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
        busy={busy}
      />
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </>
  );
}
