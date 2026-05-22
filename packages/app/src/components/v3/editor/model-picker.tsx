// ModelPicker — grouped provider list with global model search.
// Configured providers show a live model catalog (fetched lazily via the
// useCatalog hook); unconfigured providers show a "Configure X" CTA.

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderCatalogEntry,
  ProviderModelEntry,
  ProviderModelsResult,
} from "@/lib/use-catalog";
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
  modelsByProvider,
  loadProviderModels,
  onChange,
  loading,
}: {
  value: ModelValue;
  providers: ProviderCatalogEntry[];
  modelsByProvider?: Record<string, ProviderModelsResult | undefined>;
  loadProviderModels?: (providerId: string) => Promise<ProviderModelsResult>;
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
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} width={360}>
        <ModelMenu
          value={value}
          providers={providers}
          modelsByProvider={modelsByProvider ?? {}}
          loadProviderModels={loadProviderModels}
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
  modelsByProvider,
  loadProviderModels,
  loading,
  onPick,
}: {
  value: ModelValue;
  providers: ProviderCatalogEntry[];
  modelsByProvider: Record<string, ProviderModelsResult | undefined>;
  loadProviderModels?: (providerId: string) => Promise<ProviderModelsResult>;
  loading?: boolean;
  onPick: (next: ModelValue) => void;
}) {
  const [search, setSearch] = useState("");

  // Kick off live fetches for every configured provider as soon as the menu opens.
  useEffect(() => {
    if (!loadProviderModels) return;
    for (const p of providers) {
      if (p.configured && !modelsByProvider[p.id]) {
        void loadProviderModels(p.id);
      }
    }
  }, [providers, modelsByProvider, loadProviderModels]);

  if (loading && providers.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: ag.muted, textAlign: "center" }}>
        Loading providers…
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

  const normalizedSearch = search.trim().toLowerCase();

  return (
    <div style={{ padding: 6, maxHeight: 480, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "4px 4px 8px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search models…"
          autoFocus
          style={{
            width: "100%",
            padding: "6px 8px",
            border: `1px solid ${ag.line}`,
            borderRadius: 4,
            background: ag.surface2,
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: ag.ink,
            outline: "none",
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {providers.map((provider) => (
          <ProviderGroup
            key={provider.id}
            provider={provider}
            modelsResult={modelsByProvider[provider.id]}
            search={normalizedSearch}
            selected={value}
            onPick={(modelName) => onPick({ provider: provider.id, name: modelName })}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderGroup({
  provider,
  modelsResult,
  search,
  selected,
  onPick,
}: {
  provider: ProviderCatalogEntry;
  modelsResult: ProviderModelsResult | undefined;
  search: string;
  selected: ModelValue;
  onPick: (model: string) => void;
}) {
  // Live fetched models take precedence; fall back to the static curated list.
  const liveModels: ProviderModelEntry[] = modelsResult?.models ?? [];
  const staticModels: ProviderModelEntry[] = provider.models.map((id) => ({ id }));
  const modelsForGroup = liveModels.length > 0 ? liveModels : staticModels;

  const filtered = search
    ? modelsForGroup.filter((m) => {
        const hay = `${m.id} ${m.displayName ?? ""} ${provider.name}`.toLowerCase();
        return hay.includes(search);
      })
    : modelsForGroup;

  // When searching, hide entire groups with no matches AND no configure-prompt to show.
  if (search && filtered.length === 0 && provider.configured) return null;

  const isLoadingModels = provider.configured && !modelsResult;

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
      {!provider.configured ? (
        <div style={{ padding: "4px 8px", fontSize: 10.5, color: ag.muted, fontStyle: "italic" }}>
          Configure {provider.name} to view models.
        </div>
      ) : isLoadingModels ? (
        <div style={{ padding: "4px 8px", fontSize: 10.5, color: ag.muted, fontStyle: "italic" }}>
          Loading models…
        </div>
      ) : filtered.length > 0 ? (
        filtered.map((model) => {
          const isSelected = selected.provider === provider.id && selected.name === model.id;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onPick(model.id)}
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
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {model.id}
              </span>
              {model.tags?.includes("free") && (
                <Tag bg={ag.line2} color={ag.muted} mono>
                  free
                </Tag>
              )}
              {isSelected && <I.Check size={11} style={{ color: ag.ok }} />}
            </button>
          );
        })
      ) : (
        <div style={{ padding: "4px 8px", fontSize: 10.5, color: ag.muted, fontStyle: "italic" }}>
          No models match.
        </div>
      )}
    </div>
  );
}
