"use client";

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface NewKeyResult extends ApiKey {
  rawKey: string;
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealKey, setRevealKey] = useState<NewKeyResult | null>(null);

  async function load() {
    const res = await fetch("/api/api-keys");
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: res.statusText })))?.error ?? "failed to load");
      return;
    }
    setKeys(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as NewKeyResult;
      setRevealKey(created);
      setName("");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Any apps using it will stop working immediately.")) return;
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: res.statusText })))?.error ?? "failed to revoke");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={createKey} className="flex gap-2 rounded-xl border border-stone-200 bg-white p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. 'production', 'my-app')"
          className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create key"}
        </button>
      </form>

      {revealKey && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="mb-1 text-sm font-semibold text-amber-900">
            Save this key now — you won't see it again
          </div>
          <div className="mb-2 text-xs text-amber-800">
            Copy and store it somewhere safe. Closing this banner clears it from the page.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900">
              {revealKey.rawKey}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(revealKey.rawKey)}
              className="rounded border border-amber-400 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Copy
            </button>
            <button
              onClick={() => setRevealKey(null)}
              className="rounded px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Prefix</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {keys === null && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">Loading…</td></tr>
            )}
            {keys && keys.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-zinc-500">No API keys yet.</td></tr>
            )}
            {keys?.map((k) => (
              <tr key={k.id}>
                <td className="px-4 py-3 font-medium text-zinc-950">{k.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700">{k.keyPrefix}…</td>
                <td className="px-4 py-3 text-zinc-600">{formatDate(k.createdAt)}</td>
                <td className="px-4 py-3 text-zinc-600">{k.lastUsedAt ? formatDate(k.lastUsedAt) : "—"}</td>
                <td className="px-4 py-3">
                  {k.revokedAt
                    ? <span className="rounded bg-stone-200 px-2 py-0.5 text-xs text-zinc-600">Revoked</span>
                    : <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Active</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {!k.revokedAt && (
                    <button
                      onClick={() => revoke(k.id)}
                      className="text-xs font-medium text-rose-700 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}
