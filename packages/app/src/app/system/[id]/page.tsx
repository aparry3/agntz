import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { isSuperAdmin } from "@/lib/admin";
import { getSystemAgent } from "@agent-runner/worker";
import { YamlViewer } from "@/components/yaml-viewer";

export default async function SystemAgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isSuperAdmin(userId)) redirect("/agents");

  const { id } = await params;
  const info = await getSystemAgent(decodeURIComponent(id));
  if (!info) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <Link href="/system" className="text-xs text-zinc-500 hover:underline">
          ← System agents
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">{info.displayName}</h1>
          <p className="mt-1 font-mono text-xs text-zinc-500">{info.id}</p>
          {info.description && (
            <p className="mt-2 text-sm text-zinc-600">{info.description}</p>
          )}
        </div>
        <span className="shrink-0 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
          Read-only
        </span>
      </div>

      <div className="mb-2 text-xs text-zinc-500">
        Source: <span className="font-mono">{info.sourcePath}</span>
      </div>

      <YamlViewer value={info.yaml} />

      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-4 text-sm text-zinc-700">
        <p className="mb-2 font-medium text-zinc-950">Invoking this agent</p>
        <p className="mb-3 text-xs text-zinc-600">
          Callers reference it by id. The worker loads the YAML directly; no DB row, no
          per-user state.
        </p>
        <pre className="overflow-x-auto rounded bg-stone-100 p-3 text-xs">
          <code>{`POST /run
{
  "agentId": "${info.id}",
  "input": { /* ... */ }
}`}</code>
        </pre>
      </div>
    </div>
  );
}
