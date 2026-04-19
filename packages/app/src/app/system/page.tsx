import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { isSuperAdmin } from "@/lib/admin";
import { workerListSystemAgents } from "@/lib/worker-client";

export default async function SystemAgentsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isSuperAdmin(userId)) redirect("/agents");

  const agents = await workerListSystemAgents();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">System Agents</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Agents bundled with the worker (YAML in source). They power application
            features like <span className="font-mono">system:agent-builder</span> for
            &ldquo;Create from description&rdquo;. Read-only — edit the YAML and redeploy
            to change behavior.
          </p>
        </div>
        <span className="shrink-0 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
          Super admin
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Id</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {agents.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  No system agents bundled.
                </td>
              </tr>
            )}
            {agents.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700">{a.id}</td>
                <td className="px-4 py-3 font-medium text-zinc-950">{a.displayName}</td>
                <td className="px-4 py-3 text-zinc-600">{a.description ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/system/${encodeURIComponent(a.name)}`}
                    className="text-xs font-medium text-zinc-700 hover:underline"
                  >
                    View YAML →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
