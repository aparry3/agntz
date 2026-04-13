"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface ValidationError {
  level: string;
  path: string;
  message: string;
}

interface ValidationWarning {
  path: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export default function AgentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [manifest, setManifest] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch(`/api/agents/${id}`)
      .then((r) => r.json())
      .then((agent) => {
        setManifest(agent.metadata?.manifest ?? "");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const validateDebounced = useCallback((yaml: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!yaml.trim()) {
        setValidation(null);
        return;
      }
      setValidating(true);
      try {
        const res = await fetch("/api/agents/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: yaml }),
        });
        const result = await res.json();
        setValidation(result);
      } catch {
        // Ignore validation fetch errors
      } finally {
        setValidating(false);
      }
    }, 500);
  }, []);

  const handleChange = (value: string) => {
    setManifest(value);
    setStatus(null);
    validateDebounced(value);
  };

  const handleSave = async () => {
    if (validation && !validation.valid) {
      setStatus("Error: fix validation errors before saving");
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest }),
      });
      if (res.ok) {
        const body = await res.json();
        const warnCount = body.warnings?.length ?? 0;
        setStatus(warnCount > 0 ? `Saved (${warnCount} warnings)` : "Saved");
      } else {
        const body = await res.json();
        setStatus(`Error: ${body.error}`);
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${id}"?`)) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    router.push("/agents");
  };

  if (loading) {
    return <p className="text-zinc-500">Loading...</p>;
  }

  const hasErrors = validation && validation.errors.length > 0;
  const hasWarnings = validation && validation.warnings.length > 0;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{id}</h1>
          <div className="flex gap-3 mt-1">
            <Link
              href={`/agents/${id}/playground`}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Playground
            </Link>
            {validating && <span className="text-sm text-zinc-500">Validating...</span>}
            {validation && !validating && (
              <span className={`text-sm ${validation.valid ? "text-green-400" : "text-red-400"}`}>
                {validation.valid ? "Valid" : `${validation.errors.length} error(s)`}
                {hasWarnings && !hasErrors && ` (${validation.warnings.length} warning(s))`}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {status && (
            <span className={`text-sm ${status.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
              {status}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || (hasErrors ?? false)}
            className="bg-zinc-100 text-zinc-900 px-4 py-2 rounded text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handleDelete}
            className="bg-red-900 text-red-100 px-4 py-2 rounded text-sm font-medium hover:bg-red-800"
          >
            Delete
          </button>
        </div>
      </div>

      <textarea
        value={manifest}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
        className={`w-full bg-zinc-900 border rounded-lg p-4 font-mono text-sm resize-none focus:outline-none ${
          hasErrors
            ? "border-red-700 focus:border-red-500"
            : hasWarnings
              ? "border-yellow-700 focus:border-yellow-500"
              : "border-zinc-700 focus:border-zinc-500"
        } ${hasErrors || hasWarnings ? "h-[calc(100vh-360px)]" : "h-[calc(100vh-200px)]"}`}
        spellCheck={false}
        placeholder="# Write your agent YAML manifest here..."
      />

      {(hasErrors || hasWarnings) && (
        <div className="mt-3 max-h-40 overflow-auto">
          {validation!.errors.map((err, i) => (
            <div key={`e-${i}`} className="flex gap-2 text-sm py-1">
              <span className="text-red-400 shrink-0">error</span>
              <span className="text-zinc-500 shrink-0 font-mono">{err.path || "root"}</span>
              <span className="text-zinc-300">{err.message}</span>
            </div>
          ))}
          {validation!.warnings.map((warn, i) => (
            <div key={`w-${i}`} className="flex gap-2 text-sm py-1">
              <span className="text-yellow-400 shrink-0">warn</span>
              <span className="text-zinc-500 shrink-0 font-mono">{warn.path || "root"}</span>
              <span className="text-zinc-300">{warn.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
