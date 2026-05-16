"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface SecretSummary {
  name: string;
  lastFour: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SecretSummary | null>(null);

  const loadSecrets = () => {
    fetch("/api/secrets")
      .then((r) => r.json())
      .then((data) => setSecrets(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSecrets();
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/secrets/${encodeURIComponent(deleteTarget.name)}`, {
      method: "DELETE",
    });
    setDeleteTarget(null);
    loadSecrets();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Secrets</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Encrypted credentials referenced in agent manifests via{" "}
            <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
              {"{{secrets.<name>}}"}
            </code>
            . Values are never returned by this UI.
          </p>
        </div>
        <Link
          href="/settings/secrets/new"
          className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          New Secret
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
          <p className="text-zinc-500">Loading secrets...</p>
        </div>
      ) : secrets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
            <svg
              className="h-8 w-8 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 11c0-1.657-1.343-3-3-3s-3 1.343-3 3 1.343 3 3 3 3-1.343 3-3zm0 0V7a4 4 0 118 0v4m-4 4v6m0-6H8m12-6a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-medium text-zinc-900">No secrets yet</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Create your first secret to store API tokens and other credentials.
          </p>
          <Link
            href="/settings/secrets/new"
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Create your first secret
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {secrets.map((secret) => (
            <div key={secret.name} className="group relative">
              <Link
                href={`/settings/secrets/${encodeURIComponent(secret.name)}`}
                className="block h-full rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300"
              >
                <div className="font-mono text-sm font-medium text-zinc-950">
                  {secret.name}
                </div>
                <div className="mt-2 font-mono text-xs text-zinc-500">
                  ••••{secret.lastFour}
                </div>
                {secret.description && (
                  <div className="mt-3 text-sm leading-6 text-zinc-600 line-clamp-3">
                    {secret.description}
                  </div>
                )}
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteTarget(secret);
                }}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/90 text-zinc-400 opacity-0 transition-all hover:border-red-200 hover:text-red-500 group-hover:opacity-100"
                title="Delete secret"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Secret"
        message={`Are you sure you want to delete "${
          deleteTarget?.name ?? ""
        }"? Agents that reference {{secrets.${
          deleteTarget?.name ?? ""
        }}} will fail until you re-create it.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
