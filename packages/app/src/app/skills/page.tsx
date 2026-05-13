"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface SkillSummary {
  name: string;
  description: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);

  const loadSkills = () => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => setSkills(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/skills/${encodeURIComponent(deleteTarget.name)}`, { method: "DELETE" });
    setDeleteTarget(null);
    loadSkills();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Skills</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Reusable instruction + tool bundles agents can opt into mid-run.
          </p>
        </div>
        <Link
          href="/skills/new"
          className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          New Skill
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-[2rem] border border-stone-200 bg-white py-20 shadow-sm">
          <p className="text-zinc-500">Loading skills...</p>
        </div>
      ) : skills.length === 0 ? (
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
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-medium text-zinc-900">No skills yet</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Create your first skill to bundle instructions and tools for your agents.
          </p>
          <Link
            href="/skills/new"
            className="rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Create your first skill
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <div key={skill.name} className="group relative">
              <Link
                href={`/skills/${encodeURIComponent(skill.name)}`}
                className="block h-full rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300"
              >
                <div className="font-mono text-sm font-medium text-zinc-950">{skill.name}</div>
                {skill.description && (
                  <div className="mt-3 text-sm leading-6 text-zinc-600 line-clamp-3">
                    {skill.description}
                  </div>
                )}
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteTarget(skill);
                }}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/90 text-zinc-400 opacity-0 transition-all hover:border-red-200 hover:text-red-500 group-hover:opacity-100"
                title="Delete skill"
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
        title="Delete Skill"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ""}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
