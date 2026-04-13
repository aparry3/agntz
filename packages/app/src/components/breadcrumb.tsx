import Link from "next/link";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-zinc-300">/</span>}
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-zinc-950">
              {item.label}
            </Link>
          ) : (
            <span className="text-zinc-900">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
