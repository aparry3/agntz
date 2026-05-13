"use client";

import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { SkillEditor, type SkillDraft } from "@/components/skill-editor";

export default function NewSkillPage() {
  const router = useRouter();

  const handleSubmit = async (draft: SkillDraft) => {
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data?.error ?? `Failed to create skill (${res.status})` };
    }
    router.push(`/skills/${encodeURIComponent(draft.name)}`);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumb items={[{ label: "Skills", href: "/skills" }, { label: "New Skill" }]} />
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">New Skill</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Bundle instructions and tools an agent can opt into via <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">use_skill</code>.
        </p>
      </div>
      <SkillEditor
        initial={{ name: "", description: "", instructions: "", tools: [] }}
        submitLabel="Create skill"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
      />
    </div>
  );
}
