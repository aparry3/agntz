import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Overview
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950">Agent Runner</h1>
          <p className="mt-4 text-base leading-7 text-zinc-600">
            Define, iterate on, and manage AI agents with a cleaner workspace and a simpler editing flow.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
        <DashboardCard
          href="/agents"
          title="Agents"
          description="Create and manage agent definitions"
        />
        <DashboardCard
          href="/sessions"
          title="Sessions"
          description="Browse conversation history"
        />
        <DashboardCard
          href="/logs"
          title="Logs"
          description="View invocation logs"
        />
        <DashboardCard
          href="/tools"
          title="Tools"
          description="Inspect registered tools"
        />
        </div>
      </div>
    </div>
  );
}

function DashboardCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-stone-200 bg-stone-50 p-5 transition hover:border-stone-300 hover:bg-white"
    >
      <h2 className="mb-1 text-lg font-semibold text-zinc-950">{title}</h2>
      <p className="text-sm leading-6 text-zinc-600">{description}</p>
    </Link>
  );
}
