// ModelPicker — labelled trigger + popover for picking provider + model.
// Pulls the catalog from useCatalog() so the live "configured" flag from
// /api/providers is reflected.

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ProviderCatalogEntry } from "@/lib/use-catalog";
import { I } from "@/components/v3/icons";
import { Mono, Tag, ag } from "@/components/v3/primitives";
import { Popover } from "./editable-fields";

export interface ModelValue {
  provider: string;
  name: string;
}

export function ModelPicker({
  value,
  providers,
  onChange,
  loading,
}: {
  value: ModelValue;
  providers: ProviderCatalogEntry[];
  onChange: (next: ModelValue) => void;
  loading?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const display = value.provider || value.name
    ? `${value.provider}${value.name ? ` · ${value.name}` : ""}`
    : "Select a model";

  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: ag.muted,
          fontWeight: 500,
          fontFamily: "var(--font-mono)",
        }}
      >
        Model
      </div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          marginTop: 5,
          border: `1px solid ${ag.line}`,
          borderRadius: 4,
          padding: "6px 10px",
          background: ag.surface2,
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: ag.ink,
          cursor: "pointer",
          gap: 6,
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {display}
        </span>
        <I.Chev size={11} style={{ color: ag.muted }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={320}>
        <ModelMenu
          value={value}
          providers={providers}
          loading={loading}
          onPick={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function ModelMenu({
  value,
  providers,
  loading,
  onPick,
}: {
  value: ModelValue;
  providers: ProviderCatalogEntry[];
  loading?: boolean;
  onPick: (next: ModelValue) => void;
}) {
  if (loading && providers.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: ag.muted, textAlign: "center" }}>
        Loading models…
      </div>
    );
  }
  if (providers.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: ag.muted, textAlign: "center" }}>
        No providers available.
      </div>
    );
  }

  return (
    <div style={{ padding: 6 }}>
      {providers.map((provider) => (
        <ProviderGroup
          key={provider.id}
          provider={provider}
          selected={value}
          onPick={(modelName) => onPick({ provider: provider.id, name: modelName })}
        />
      ))}
    </div>
  );
}

function ProviderGroup({
  provider,
  selected,
  onPick,
}: {
  provider: ProviderCatalogEntry;
  selected: ModelValue;
  onPick: (model: string) => void;
}) {
  const hasModels = provider.models.length > 0;
  return (
    <div style={{ padding: "6px 4px", borderBottom: `1px solid ${ag.line2}` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 6px 6px",
        }}
      >
        <Mono size={11} color={ag.text2} style={{ fontWeight: 600 }}>
          {provider.name}
        </Mono>
        {provider.configured ? (
          <Tag bg={ag.okBg} color={ag.ok} mono>
            <I.Dot size={5} color={ag.ok} />
            configured
          </Tag>
        ) : (
          <Tag bg={ag.line2} color={ag.muted} mono>
            unconfigured
          </Tag>
        )}
        {!provider.configured && (
          <Link
            href="/settings/connections"
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: ag.blue,
              textDecoration: "none",
            }}
          >
            Configure →
          </Link>
        )}
      </div>
      {hasModels ? (
        provider.models.map((modelName) => {
          const isSelected = selected.provider === provider.id && selected.name === modelName;
          return (
            <button
              key={modelName}
              type="button"
              onClick={() => onPick(modelName)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: "5px 8px",
                background: isSelected ? ag.bg : "transparent",
                border: 0,
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: ag.ink,
                textAlign: "left",
                gap: 6,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = ag.surfaceWarm;
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ flex: 1 }}>{modelName}</span>
              {isSelected && <I.Check size={11} style={{ color: ag.ok }} />}
            </button>
          );
        })
      ) : (
        <div style={{ padding: "4px 8px", fontSize: 10.5, color: ag.muted, fontStyle: "italic" }}>
          No models defined.
        </div>
      )}
    </div>
  );
}
