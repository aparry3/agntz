"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { I } from "@/components/v3/icons";
import { Avatar, HR, Kbd, ag } from "@/components/v3/primitives";

type IconCmp = ComponentType<{ size?: number }>;
interface NavLink {
  href: string;
  label: string;
  Ic: IconCmp;
  matches?: (pathname: string) => boolean;
}

const buildLinks: NavLink[] = [
  { href: "/agents", label: "Agents", Ic: I.Agents, matches: (p) => p === "/agents" || p.startsWith("/agents/") },
  { href: "/skills", label: "Skills", Ic: I.Skills, matches: (p) => p === "/skills" || p.startsWith("/skills/") },
];

const observeLinks: NavLink[] = [
  { href: "/runs", label: "Runs", Ic: I.Runs, matches: (p) => p === "/runs" || p.startsWith("/runs/") },
  { href: "/traces", label: "Traces", Ic: I.Traces, matches: (p) => p === "/traces" || p.startsWith("/traces/") },
  { href: "/logs", label: "Logs", Ic: I.Logs },
  { href: "/sessions", label: "Sessions", Ic: I.Sessions },
];

const configureLinks: NavLink[] = [
  { href: "/settings", label: "Settings", Ic: I.Settings },
  { href: "/settings/api-keys", label: "API Keys", Ic: I.Key },
  { href: "/settings/secrets", label: "Secrets", Ic: I.Lock },
];

const COLLAPSE_STORAGE_KEY = "agntz.sidebar.collapsed";

export function AppSidebar() {
  const pathname = usePathname() ?? "";
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [isAdmin, setIsAdmin] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Persist collapsed state. Edit-style pages can default to collapsed via
  // the layout, but the user's explicit preference wins after first interaction.
  useEffect(() => {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === "1") setCollapsed(true);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed, mounted]);

  useEffect(() => {
    if (!isSignedIn) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.isSuperAdmin) setIsAdmin(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const W = collapsed ? 56 : 218;

  const isActive = (link: NavLink) =>
    link.matches ? link.matches(pathname) : pathname === link.href;

  const displayName = useMemo(() => {
    if (!user) return "Account";
    return user.fullName || user.firstName || user.username || user.primaryEmailAddress?.emailAddress || "Account";
  }, [user]);

  const displayEmail = user?.primaryEmailAddress?.emailAddress;

  return (
    <aside
      style={{
        width: W,
        background: ag.surface,
        borderRight: `1px solid ${ag.line}`,
        display: "flex",
        flexDirection: "column",
        flex: "0 0 auto",
        transition: "width 160ms ease",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      {/* Workspace switcher + collapse toggle */}
      <div
        style={{
          padding: collapsed ? "12px 0 10px" : "14px 12px 10px",
          borderBottom: `1px solid ${ag.line2}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <Link
          href="/"
          aria-label="agntz home"
          style={{
            width: 26,
            height: 26,
            background: ag.ink,
            color: ag.surface,
            borderRadius: 4,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            flex: "0 0 auto",
            textDecoration: "none",
          }}
        >
          a
        </Link>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 9.5,
                marginBottom: 1,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: ag.muted,
                fontWeight: 500,
              }}
            >
              Workspace
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: ag.ink }}>agntz</div>
              <I.Chev size={11} />
            </div>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            style={iconBtnStyle}
          >
            <I.ChevR size={11} style={{ transform: "rotate(180deg)" }} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          style={{ ...iconBtnStyle, margin: "8px auto 0" }}
        >
          <I.ChevR size={11} />
        </button>
      )}

      {/* Search */}
      <div style={{ padding: collapsed ? "10px 0 4px" : "10px 10px 4px" }}>
        {collapsed ? (
          <div
            title="Search (⌘K)"
            style={{
              margin: "0 auto",
              width: 30,
              height: 28,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${ag.line}`,
              background: ag.surface2,
              borderRadius: 4,
              color: ag.muted,
            }}
          >
            <I.Search size={13} />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 8px",
              border: `1px solid ${ag.line}`,
              background: ag.surface2,
              borderRadius: 4,
              color: ag.muted,
            }}
          >
            <I.Search size={12} />
            <span style={{ fontSize: 12, flex: 1 }}>Search…</span>
            <Kbd>⌘K</Kbd>
          </div>
        )}
      </div>

      {/* Sections */}
      <nav style={{ padding: collapsed ? "4px 8px" : "6px 8px", flex: 1, overflowY: "auto" }}>
        <NavSection label="Build" collapsed={collapsed} first>
          {buildLinks.map((link) => (
            <NavItem key={link.href} {...link} on={isActive(link)} collapsed={collapsed} />
          ))}
        </NavSection>
        <NavSection label="Observe" collapsed={collapsed}>
          {observeLinks.map((link) => (
            <NavItem key={link.href} {...link} on={isActive(link)} collapsed={collapsed} />
          ))}
        </NavSection>

        {/* Configure — collapsible group */}
        <div style={{ marginTop: 12 }}>
          {!collapsed ? (
            <button
              onClick={() => setConfigOpen((o) => !o)}
              style={{
                width: "100%",
                border: 0,
                background: "transparent",
                padding: "2px 8px 4px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 9.5,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: ag.muted,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <I.ChevR
                size={9}
                style={{ transform: configOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" }}
              />
              Configure
            </button>
          ) : (
            <HR style={{ margin: "8px 6px" }} />
          )}
          {(configOpen || collapsed) &&
            configureLinks.map((link) => (
              <NavItem key={link.href} {...link} on={isActive(link)} collapsed={collapsed} />
            ))}
        </div>
      </nav>

      {/* System Agents (admin) */}
      {isAdmin && (
        <div style={{ padding: collapsed ? "4px 8px 6px" : "4px 8px 8px" }}>
          <Link
            href="/system"
            title={collapsed ? "System Agents" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: collapsed ? "6px 0" : "5px 8px",
              justifyContent: collapsed ? "center" : "flex-start",
              borderRadius: 4,
              color: pathname.startsWith("/system") ? ag.surface : ag.text2,
              background: pathname.startsWith("/system") ? ag.ink : "transparent",
              fontSize: 12.5,
              textDecoration: "none",
            }}
          >
            <I.Admin size={13} />
            {!collapsed && <span style={{ flex: 1 }}>System Agents</span>}
            {!collapsed && (
              <span
                style={{
                  background: ag.warnBg,
                  color: ag.warn,
                  padding: "2px 6px",
                  borderRadius: 3,
                  fontSize: 10.5,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 500,
                }}
              >
                admin
              </span>
            )}
          </Link>
        </div>
      )}

      {/* Account */}
      <div
        style={{
          padding: collapsed ? "10px 0" : "10px 12px",
          borderTop: `1px solid ${ag.line2}`,
          display: "flex",
          alignItems: "center",
          gap: 9,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        {isSignedIn ? (
          <>
            <div style={{ flex: "0 0 auto" }}>
              <UserButton appearance={{ elements: { avatarBox: { width: collapsed ? 24 : 22, height: collapsed ? 24 : 22, borderRadius: 4 } } }} />
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: ag.ink }}>{displayName}</div>
                {displayEmail && (
                  <div
                    style={{
                      fontSize: 10.5,
                      color: ag.muted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {displayEmail}
                  </div>
                )}
              </div>
            )}
            {!collapsed && <I.Ellipsis size={14} />}
          </>
        ) : (
          <>
            <Avatar name="?" size={collapsed ? 24 : 22} square />
            {!collapsed && (
              <Link href="/sign-in" style={{ flex: 1, fontSize: 12.5, color: ag.ink, textDecoration: "none" }}>
                Sign in
              </Link>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

const iconBtnStyle: CSSProperties = {
  border: `1px solid ${ag.line}`,
  background: ag.surface2,
  borderRadius: 3,
  padding: "3px 4px",
  cursor: "pointer",
  color: ag.muted,
  display: "grid",
  placeItems: "center",
};

function NavSection({
  label,
  collapsed,
  children,
  first,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <div style={{ marginTop: first ? 4 : 12 }}>
      {!collapsed && (
        <div
          style={{
            padding: "2px 8px 4px",
            fontSize: 9.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: ag.muted,
            fontWeight: 500,
          }}
        >
          {label}
        </div>
      )}
      {collapsed && !first && <HR style={{ margin: "8px 6px" }} />}
      {children}
    </div>
  );
}

function NavItem({
  href,
  label,
  Ic,
  on,
  collapsed,
  badge,
}: NavLink & {
  on: boolean;
  collapsed: boolean;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: collapsed ? "6px 0" : "5px 8px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 4,
        marginBottom: 1,
        background: on ? ag.ink : "transparent",
        color: on ? ag.surface : ag.text2,
        fontSize: 12.5,
        fontWeight: on ? 500 : 400,
        textDecoration: "none",
      }}
    >
      <Ic size={13} />
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
      {!collapsed && badge}
    </Link>
  );
}
