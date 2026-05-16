"use client";

import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import {
  SecretEditor,
  type SecretEditorSubmit,
} from "@/components/secret-editor";

export default function NewSecretPage() {
  const router = useRouter();

  const handleSubmit = async (draft: SecretEditorSubmit) => {
    const res = await fetch("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        value: draft.value,
        description: draft.description.trim() ? draft.description : undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: data?.error ?? `Failed to create secret (${res.status})` };
    }
    router.push("/settings/secrets");
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumb
        items={[
          { label: "Secrets", href: "/settings/secrets" },
          { label: "New Secret" },
        ]}
      />
      <div className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">
          New Secret
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Store an encrypted credential referenced from agent manifests as{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">
            {"{{secrets.<name>}}"}
          </code>
          .
        </p>
      </div>
      <SecretEditor
        initial={{ name: "", value: "", description: "" }}
        submitLabel="Create secret"
        submittingLabel="Creating..."
        onSubmit={handleSubmit}
      />
    </div>
  );
}
