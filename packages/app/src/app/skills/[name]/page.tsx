"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SkillEditor, type SkillDraft, type ToolRef } from "@/components/skill-editor";

interface SkillResponse {
  name: string;
  description: string;
  instructions: string;
  tools?: ToolRef[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: routeName } = use(params);
  const skillName = decodeURIComponent(routeName);
  const router = useRouter();

  const [skill, setSkill] = useState<SkillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch(`/api/skills/${encodeURIComponent(skillName)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data?.error ?? `Failed to load skill (${r.status})`);
          return;
        }
        setSkill(await r.json());
      })
      .finally(() => setLoading(false));
  }, [skillName]);

  const handleSubmit = async (draft: SkillDraft) => {
    const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: draft.description,
        instructions: draft.instructions,
        tools: draft.tools,
        metadata: skill?.metadata,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data?.error ?? `Failed to save skill (${res.status})` };
    }
    const updated = await fetch(`/api/skills/${encodeURIComponent(skillName)}`).then((r) => r.json());
    setSkill(updated);
  };

  const handleDelete = async () => {
    await fetch(`/api/skills/${encodeURIComponent(skillName)}`, { method: "DELETE" });
    setConfirmDelete(false);
    router.push("/skills");
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumb items={[{ label: "Skills", href: "/skills" }, { label: skillName }]} />

      {loading ? (
        <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-10 text-sm text-zinc-500 shadow-sm">
          Loading skill...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : skill ? (
        <>
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-3xl font-semibold tracking-tight text-zinc-950">{skill.name}</h1>
              {skill.updatedAt && (
                <p className="mt-2 text-xs text-zinc-500">
                  Updated {new Date(skill.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              Delete
            </button>
          </div>

          <SkillEditor
            initial={{
              name: skill.name,
              description: skill.description,
              instructions: skill.instructions,
              tools: skill.tools ?? [],
            }}
            lockName
            submitLabel="Save changes"
            submittingLabel="Saving..."
            onSubmit={handleSubmit}
          />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Skill"
        message={`Are you sure you want to delete "${skillName}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
