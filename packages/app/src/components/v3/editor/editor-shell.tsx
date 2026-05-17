// EditorShell — V3 page header (breadcrumb, title, id chip, kind/status tags,
// History/Playground/Save buttons). The body is plugged in by the parent.

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { I } from "@/components/v3/icons";
import { Btn, Crumbs, Mono, Tag, ag } from "@/components/v3/primitives";

export function EditorShell({
  breadcrumb,
  title,
  manifestId,
  kindTag,
  statusTag,
  metaRight,
  actionsLeft,
  secondaryActions,
  onSave,
  saving,
  dirty,
  saveLabel = "Save",
  saveLabelDirty,
  children,
}: {
  breadcrumb: Array<string | ReactNode>;
  title: string;
  manifestId: string;
  kindTag?: ReactNode;
  statusTag?: ReactNode;
  metaRight?: ReactNode;
  actionsLeft?: ReactNode;
  /** Overrides the default History + Playground buttons when provided. */
  secondaryActions?: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  /** When false, Save is disabled. When undefined, Save is always enabled (legacy behavior). */
  dirty?: boolean;
  saveLabel?: string;
  /** Optional override label shown when dirty=true (e.g. "Save changes"). */
  saveLabelDirty?: string;
  children: ReactNode;
}) {
  const saveDisabled = saving || (dirty === false);
  const effectiveLabel = saving
    ? "Saving…"
    : dirty && saveLabelDirty
    ? saveLabelDirty
    : saveLabel;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, height: "100vh" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 28px 14px",
          borderBottom: `1px solid ${ag.line2}`,
          background: ag.bg,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Crumbs trail={breadcrumb} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              <CopyIdButton manifestId={manifestId} />
              {kindTag}
              {statusTag ?? (
                <Tag bg={ag.okBg} color={ag.ok}>
                  <I.Dot size={6} color={ag.ok} />
                  Ready
                </Tag>
              )}
              {metaRight}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
            {actionsLeft}
            {secondaryActions ?? (
              <>
                <Btn variant="secondary" icon={<I.Hist size={12} style={{ marginRight: 6 }} />}>
                  History
                </Btn>
                <Btn variant="secondary" icon={<I.Play size={11} style={{ marginRight: 6 }} />}>
                  Playground
                </Btn>
              </>
            )}
            {onSave && (
              <Btn variant="primary" onClick={onSave} disabled={saveDisabled}>
                {effectiveLabel}
              </Btn>
            )}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}

function CopyIdButton({ manifestId }: { manifestId: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(manifestId);
      setCopied(true);
    } catch {
      // ignore — older browsers / blocked clipboard
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy agent id"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${ag.line}`,
        borderRadius: 4,
        padding: "3px 8px",
        background: ag.surface2,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <Mono size={11.5}>{manifestId}</Mono>
      {copied ? (
        <I.Check size={11} style={{ color: ag.ok }} />
      ) : (
        <I.Copy size={11} style={{ color: ag.muted }} />
      )}
    </button>
  );
}
