"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton, useAuth } from "@clerk/nextjs";

const primaryLinks = [
  { href: "/agents", label: "Agents" },
  { href: "/sessions", label: "Sessions" },
  { href: "/logs", label: "Logs" },
  { href: "/tools", label: "Tools" },
];

const secondaryLinks = [
  { href: "/settings", label: "Settings" },
  { href: "/settings/api-keys", label: "API Keys" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  return (
    <aside className="border-b border-stone-200 bg-white/90 backdrop-blur lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col px-4 py-5 sm:px-6 lg:px-5 lg:py-6">
        <Link href="/" className="mb-6 block px-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
            Workspace
          </div>
          <div className="mt-2 text-xl font-semibold text-zinc-950">Agent Runner</div>
        </Link>

        {isSignedIn && (
          <div className="mb-4 px-3">
            <OrganizationSwitcher
              hidePersonal
              afterCreateOrganizationUrl="/onboarding"
              afterSelectOrganizationUrl="/agents"
              appearance={{
                elements: {
                  rootBox: "w-full",
                  organizationSwitcherTrigger: "w-full justify-start",
                },
              }}
            />
          </div>
        )}

        <nav className="flex flex-col gap-1">
          {primaryLinks.map((link) => (
            <SidebarLink
              key={link.href}
              href={link.href}
              active={pathname === link.href || (link.href === "/agents" && pathname.startsWith("/agents/"))}
            >
              {link.label}
            </SidebarLink>
          ))}
        </nav>

        <div className="my-6 hidden h-px bg-stone-200 lg:block" />

        <nav className="flex flex-col gap-1">
          {secondaryLinks.map((link) => (
            <SidebarLink key={link.href} href={link.href} active={pathname === link.href}>
              {link.label}
            </SidebarLink>
          ))}
        </nav>

        {isSignedIn && (
          <div className="mt-auto flex items-center gap-3 px-3 pt-6">
            <UserButton />
            <span className="text-sm text-zinc-500">Account</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-950 text-white shadow-sm"
          : "text-zinc-600 hover:bg-stone-100 hover:text-zinc-950"
      }`}
    >
      {children}
    </Link>
  );
}
