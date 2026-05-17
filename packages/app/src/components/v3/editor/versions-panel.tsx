// VersionsPanel — slide-in modal showing all saved versions of an agent.
// Each row exposes "Activate" (re-pin the active version) and "Copy reference"
// (writes `<id>@<isoTimestamp>` to the clipboard) so the SDK call site
// `agntz.run("reviewer@<ts>", input)` is one click away.

"use client";

import { useEffect, useState } from "react";
import { I } from "@/components/v3/icons";
import { Btn, Mono, ag } from "@/components/v3/primitives";

interface VersionRow {
  createdAt: string;
  activatedAt: string | null;
}

export function VersionsPanel({
  open,
  agentId,
  onClose,
}: {
  open: boolean;
  agentId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agents/${encodeURIComponent(agentId)}/versions`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data.versions ?? []);
        setRows(list as VersionRow[]);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, agentId]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, onClose]);

  useEffect(() => {
    if (!copiedRef) return;
    const t = setTimeout(() => setCopiedRef(null), 1200);
    return () => clearTimeout(t);
  }, [copiedRef]);

  if (!open) return null;

  const copyRef = async (ref: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(ref);
      setCopiedRef(ref);
    } catch {
      // ignore clipboard failures (permissions / older browsers)
    }
  };

  const handleActivate = async (createdAt: string) => {
    setActivating(createdAt);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(createdAt)}/activate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refetch so `activatedAt` updates locally.
      const fresh = await fetch(`/api/agents/${encodeURIComponent(agentId)}/versions`).then((r) =>
        r.json(),
      );
      const list = Array.isArray(fresh) ? fresh : (fresh.versions ?? []);
      setRows(list as VersionRow[]);
    } catch (err) {
      setError(String(err));
    } finally {
      setActivating(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(20,20,20,0.32)" }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 720,
          maxHeight: "80vh",
          background: ag.surface,
          border: `1px solid ${ag.line}`,
          borderRadius: 12,
          boxShadow: "0 24px 60px rgba(20,20,20,0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${ag.line2}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: ag.ink }}>Versions</div>
            <div style={{ fontSize: 11.5, color: ag.muted, marginTop: 2 }}>
              Activate a version to pin it as the default, or copy a reference to call a
              specific version from the SDK.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: `1px solid ${ag.line}`,
              borderRadius: 4,
              background: ag.surface2,
              padding: "4px 6px",
              cursor: "pointer",
            }}
          >
            <I.X size={11} />
          </button>
        </div>
        <div style={{ overflow: "auto", padding: "4px 0" }}>
          {loading && (
            <div style={{ padding: 18, color: ag.muted, fontSize: 12 }}>Loading versions…</div>
          )}
          {error && (
            <div style={{ padding: 18, color: ag.danger, fontSize: 12 }}>{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div style={{ padding: 18, color: ag.muted, fontSize: 12 }}>
              No versions saved yet.
            </div>
          )}
          {!loading &&
            !error &&
            rows.map((row, i) => {
              const ref = `${agentId}@${row.createdAt}`;
              const isActivated = row.activatedAt !== null;
              const isCopied = copiedRef === ref;
              const isActivating = activating === row.createdAt;
              return (
                <div
                  key={row.createdAt}
                  style={{
                    padding: "10px 18px",
                    borderTop: i === 0 ? "none" : `1px solid ${ag.line2}`,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Mono size={11.5} color={ag.text2}>
                      {row.createdAt}
                    </Mono>
                    <div style={{ fontSize: 11, color: ag.muted, marginTop: 2 }}>
                      {isActivated ? (
                        <span>
                          Activated <Mono size={10}>{row.activatedAt!}</Mono>
                        </span>
                      ) : (
                        "Not activated"
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyRef(ref)}
                    title={isCopied ? "Copied" : "Copy reference"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: `1px solid ${ag.line}`,
                      borderRadius: 4,
                      padding: "4px 8px",
                      background: ag.surface2,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {isCopied ? (
                      <I.Check size={11} style={{ color: ag.ok }} />
                    ) : (
                      <I.Copy size={11} style={{ color: ag.muted }} />
                    )}
                    <Mono size={11}>copy ref</Mono>
                  </button>
                  <Btn
                    variant="secondary"
                    onClick={() => handleActivate(row.createdAt)}
                    disabled={isActivating}
                  >
                    {isActivating ? "Activating…" : isActivated ? "Re-activate" : "Activate"}
                  </Btn>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
