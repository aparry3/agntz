// EditorShell — V3 page header (breadcrumb, title, id chip, kind/status tags,
// History/Playground/Save buttons). The body is plugged in by the parent.

import type { ReactNode } from "react";
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
  onSave,
  saving,
  saveLabel = "Save",
  children,
}: {
  breadcrumb: Array<string | ReactNode>;
  title: string;
  manifestId: string;
  kindTag?: ReactNode;
  statusTag?: ReactNode;
  metaRight?: ReactNode;
  actionsLeft?: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  children: ReactNode;
}) {
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
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: `1px solid ${ag.line}`,
                  borderRadius: 4,
                  padding: "3px 8px",
                  background: ag.surface2,
                }}
              >
                <Mono size={11.5}>{manifestId}</Mono>
                <I.Copy size={11} style={{ color: ag.muted }} />
              </div>
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
            <Btn variant="secondary" icon={<I.Hist size={12} style={{ marginRight: 6 }} />}>
              History
            </Btn>
            <Btn variant="secondary" icon={<I.Play size={11} style={{ marginRight: 6 }} />}>
              Playground
            </Btn>
            {onSave && (
              <Btn variant="primary" onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : saveLabel}
              </Btn>
            )}
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}
