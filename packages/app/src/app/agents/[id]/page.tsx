"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { parse as parseYAML, stringify as stringifyYAML } from "yaml";
import { EditorShell } from "@/components/v3/editor/editor-shell";
import { VersionsPanel } from "@/components/v3/editor/versions-panel";
import {
  SingleAgentView,
  type SingleAgentManifest,
  type SingleViewMode,
} from "@/components/v3/editor/single-agent-view";
import { PipelineView, type PipelineViewMode } from "@/components/v3/editor/pipeline-view";
import { YamlEditor } from "@/components/yaml-editor";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useCatalog } from "@/lib/use-catalog";
import { I } from "@/components/v3/icons";
import { ag, Btn, Mono, Tag } from "@/components/v3/primitives";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export default function AgentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const catalog = useCatalog();

  const [manifest, setManifest] = useState("");
  const [originalManifest, setOriginalManifest] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SingleViewMode | PipelineViewMode>("build");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const parsed = useMemo(() => {
    if (!manifest.trim()) return null;
    try {
      const value = parseYAML(manifest);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }, [manifest]);

  const isPipeline = parsed?.kind === "sequential" || parsed?.kind === "parallel";
  const manifestId = typeof parsed?.id === "string" ? parsed.id : id;
  const manifestName = typeof parsed?.name === "string" ? parsed.name : manifestId;
  const dirty = manifest !== originalManifest;

  useEffect(() => {
    fetch(`/api/agents/${id}`)
      .then((r) => r.json())
      .then((agent) => {
        const yaml = agent?.metadata?.manifest ?? "";
        setManifest(yaml);
        setOriginalManifest(yaml);
        setUpdatedAt(agent?.updatedAt ?? null);
      })
      .catch(() => setError("Failed to load agent"))
      .finally(() => setLoading(false));
  }, [id]);

  // Generic patcher: receives a fully-formed next manifest object (already
  // composed by the inspector — e.g. {...prev, description: newValue}) and
  // re-serializes to YAML. The YAML string remains the canonical persistence
  // format so the YAML view stays in sync automatically.
  const handleManifestChange = useCallback((next: Record<string, unknown>) => {
    try {
      setManifest(stringifyYAML(next, { lineWidth: 0 }));
      setStatus(null);
    } catch {
      // Should be unreachable for plain JS objects coming from inspector edits.
    }
  }, []);

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: manifestName, manifest }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save agent");
        return;
      }
      setOriginalManifest(manifest);
      setStatus("Saved");
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setShowDelete(false);
    router.push("/agents");
  };

  if (loading) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          color: ag.muted,
          fontSize: 13,
        }}
      >
        Loading agent…
      </div>
    );
  }

  return (
    <EditorShell
      breadcrumb={["agntz", "Agents", manifestName]}
      title={manifestName}
      manifestId={manifestId}
      kindTag={
        <Tag
          bg={isPipeline ? ag.purpleBg : ag.blueBg}
          color={isPipeline ? ag.purple : ag.blue}
          mono
        >
          {isPipeline ? (typeof parsed?.kind === "string" ? parsed.kind : "Pipeline") : "LLM"}
        </Tag>
      }
      statusTag={
        dirty ? (
          <Tag bg={ag.warnBg} color={ag.warn}>
            <I.Dot size={6} color={ag.warn} />
            Unsaved
          </Tag>
        ) : undefined
      }
      metaRight={
        <Mono size={11} color={ag.muted}>
          {status ?? formatUpdated(updatedAt)}
        </Mono>
      }
      actionsLeft={
        <Btn variant="danger" onClick={() => setShowDelete(true)}>
          Delete
        </Btn>
      }
      secondaryActions={
        <>
          <Btn
            variant="secondary"
            icon={<I.Hist size={12} style={{ marginRight: 6 }} />}
            onClick={() => setShowVersions(true)}
          >
            History
          </Btn>
          <Btn variant="secondary" icon={<I.Play size={11} style={{ marginRight: 6 }} />}>
            Playground
          </Btn>
        </>
      }
      onSave={handleSave}
      saving={saving}
      dirty={dirty}
      saveLabelDirty="Save changes"
    >
      {error && (
        <div
          style={{
            padding: "8px 28px",
            background: "#FBEFEA",
            borderBottom: `1px solid ${ag.line2}`,
            color: ag.danger,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <I.X size={11} />
          {error}
        </div>
      )}

      {isPipeline ? (
        <PipelineView
          rootManifest={parsed!}
          manifestId={manifestId}
          view={view as PipelineViewMode}
          onChangeView={(v) => setView(v)}
          onChange={handleManifestChange}
          catalog={catalog}
          yamlPanel={<YamlPanel manifest={manifest} setManifest={setManifest} catalog={catalog} />}
        />
      ) : (
        <SingleAgentView
          manifest={(parsed ?? { id: manifestId }) as SingleAgentManifest}
          manifestId={manifestId}
          view={view as SingleViewMode}
          onChangeView={(v) => setView(v)}
          onChange={(next) => handleManifestChange(next as Record<string, unknown>)}
          catalog={catalog}
          yamlPanel={<YamlPanel manifest={manifest} setManifest={setManifest} catalog={catalog} />}
        />
      )}

      <ConfirmDialog
        open={showDelete}
        title="Delete agent"
        message={`Permanently delete "${manifestName}" and all versions?`}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
      <VersionsPanel
        open={showVersions}
        agentId={manifestId}
        onClose={() => setShowVersions(false)}
      />
    </EditorShell>
  );
}

function YamlPanel({
  manifest,
  setManifest,
  catalog,
}: {
  manifest: string;
  setManifest: (v: string) => void;
  catalog: ReturnType<typeof useCatalog>;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: ag.surface,
        borderRight: `1px solid ${ag.line2}`,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: ag.muted,
          fontWeight: 500,
          marginBottom: 8,
        }}
      >
        Manifest
      </div>
      <YamlEditor value={manifest} onChange={setManifest} catalog={catalog} />
    </div>
  );
}

function formatUpdated(updatedAt: string | null): string {
  if (!updatedAt) return "loaded";
  const date = new Date(updatedAt);
  const diff = Math.max(0, Date.now() - date.getTime());
  const min = 60_000;
  const hr = 60 * min;
  if (diff < min) return "saved just now";
  if (diff < hr) return `saved ${Math.floor(diff / min)}m ago`;
  if (diff < 24 * hr) return `saved ${Math.floor(diff / hr)}h ago`;
  return `saved ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
