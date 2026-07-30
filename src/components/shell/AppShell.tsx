"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Bot, ClipboardList, FlaskConical, Gauge, LayoutDashboard, LayoutGrid, Loader2,
  type LucideIcon, Menu, Microscope, PanelLeft,
  PanelLeftClose, PlusCircle, Settings, Users, X,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/DemoBanner";

type Role = "instructor" | "student" | null;

interface NavEntry { href: string; label: string; icon: LucideIcon }

const INSTRUCTOR_NAV: NavEntry[] = [
  { href: "/instructor/dashboard", label: "Dashboard",           icon: LayoutDashboard },
  { href: "/instructor/create-session", label: "Create Session", icon: PlusCircle },
  { href: "/instructor/wall", label: "Bench View",               icon: LayoutGrid },
  { href: "/instructor/risk", label: "Needs Attention",          icon: Gauge },
  { href: "/instructor/verify", label: "Verification Queue",     icon: ClipboardList },
  { href: "/instructor/reports", label: "Reports",               icon: Microscope },
  { href: "/assistant", label: "AI Assistant",                   icon: Bot },
  { href: "/settings", label: "AI Settings",                     icon: Settings },
];

const STUDENT_NAV: NavEntry[] = [
  { href: "/student/dashboard", label: "Dashboard",          icon: LayoutDashboard },
  { href: "/student/join",      label: "Join Session",       icon: FlaskConical },
  { href: "/library",           label: "Experiment Library", icon: Microscope },
  { href: "/assistant",         label: "Ask LabMind",        icon: Bot },
  { href: "/settings",          label: "AI Settings",        icon: Settings },
];

function titleFor(path: string): string {
  if (path.includes("/instructor/dashboard"))    return "Instructor Dashboard";
  if (path.includes("/instructor/create-session")) return "Create Session";
  if (path.includes("/instructor/session"))      return "Session Monitor";
  if (path.includes("/instructor/verify"))       return "Verification Queue";
  if (path.includes("/instructor/wall"))         return "Bench View";
  if (path.includes("/instructor/risk"))         return "Needs Attention";
  if (path.includes("/instructor/reports"))      return "Reports";
  if (path.includes("/integrity"))               return "Timing Integrity";
  if (path.includes("/student/dashboard"))       return "Student Dashboard";
  if (path.includes("/student/join"))            return "Join Session";
  if (path.includes("/library"))                 return "Experiment Library";
  if (path.includes("/assistant"))               return "Lab Assistant";
  if (path.includes("/lab"))                     return "Lab Session";
  if (path.includes("/dashboard"))               return "Instructor Console";
  if (path.includes("/settings"))               return "AI Settings";
  return "LabMind";
}

function isActive(path: string, href: string) {
  return path === href || (href !== "/" && path.startsWith(href));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { data: session, status } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: meta } = useQuery({
    queryKey: ["meta"],
    queryFn: async () => (await fetch("/api/meta", { cache: "no-store" })).json() as Promise<{ provider: string; demo: boolean; keys_exhausted: boolean }>,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const isDemo = meta?.demo || meta?.keys_exhausted;

  // Redirect to login if not authenticated. Done in an effect, not directly in
  // the render body — calling router.replace() while AppShell itself is still
  // rendering updates the router's own state mid-render, which is what threw
  // "Cannot update a component while rendering a different component" on every
  // page load.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth");
  }, [status, router]);

  // Close the mobile nav drawer on navigation — client-side routing doesn't
  // unmount AppShell, so without this it would stay open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-brand)]" />
      </div>
    );
  }

  const role = (session?.user?.role ?? "student") as Role;
  const userName = session?.user?.name ?? session?.user?.email ?? "";
  const nav = role === "instructor" ? INSTRUCTOR_NAV : STUDENT_NAV;

  return (
    <div className="shell" data-collapsed={collapsed}>
      <aside className="sidebar">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="anim-float flex h-9 w-9 shrink-0 items-center justify-center rounded-xl overflow-hidden shadow">
              <img src="/logo2.png" alt="LabMind" className="h-9 w-9 object-contain" />
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <p className="font-bold text-white">LabMind</p>
                <p className="text-[11px] text-white/50">AI Lab Partner</p>
              </div>
            )}
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {isDemo && (
            <div className={`mb-1 flex items-center gap-2 rounded-lg bg-yellow-400/20 px-3 py-2 ${collapsed ? "justify-center" : ""}`}>
              <AlertTriangle size={15} className="shrink-0 text-yellow-300" />
              {!collapsed && <span className="text-xs font-bold text-yellow-300">DEMO MODE</span>}
            </div>
          )}
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-item" data-active={isActive(pathname, href)}>
              <Icon size={19} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          ))}
        </nav>

        <div className="px-3 pb-4">
          {!collapsed && userName && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
                {userName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{userName}</p>
                <p className="text-[11px] capitalize text-white/50">{role}</p>
              </div>
            </div>
          )}

          <button
            onClick={() => setCollapsed((c) => !c)}
            className="nav-item w-full justify-center"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span className="text-sm">Collapse</span>}
          </button>

          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/auth" })}
              className="mt-1 w-full rounded-lg px-3 py-1.5 text-left text-xs text-white/30 hover:text-white/60"
            >
              Sign out
            </button>
          )}
        </div>
      </aside>

      <div className="main-pane">
        <Topbar title={titleFor(pathname)} role={role} meta={meta} onMenu={() => setMobileNavOpen(true)} />
        <DemoBanner />
        {/* Keying on pathname replays the entrance animation on every navigation,
            so moving between pages reads as a deliberate transition rather than
            an abrupt swap. */}
        <div className="content anim-fade-up" key={pathname}>{children}</div>
      </div>

      <MobileBottomNav nav={nav} pathname={pathname} />
      {/* The bottom nav only fits 4 items, so on mobile some pages (e.g. AI
          Settings, or an instructor's 5th+ nav entry) have no nav affordance
          at all — this drawer, opened by the topbar's Menu button, surfaces
          the FULL nav list instead of leaving that button dead. */}
      <MobileNavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} nav={nav} pathname={pathname} userName={userName} role={role} />
    </div>
  );
}

function Topbar({ title, role, meta, onMenu }: { title: string; role: Role; meta?: { provider: string; demo: boolean; keys_exhausted: boolean }; onMenu: () => void }) {
  return (
    <header className="glass-topbar flex items-center justify-between px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="md:hidden text-[var(--color-navy)]" aria-label="Open menu">
          <Menu size={22} />
        </button>
        <h1 className="text-lg font-bold text-[var(--color-navy)]">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {role && (
          <span className={`chip ${role === "instructor" ? "bg-[var(--color-navy)]/10 text-[var(--color-navy)]" : "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"}`}>
            <Users size={12} /> {role}
          </span>
        )}
        <span className="chip bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
          {meta && !meta.demo && !meta.keys_exhausted ? (
            <span className="live-dot" aria-hidden />
          ) : (
            <Bot size={13} />
          )}
          {meta?.provider ?? "…"}
        </span>
        {meta?.keys_exhausted && <span className="chip bg-red-500 text-white">KEY LIMIT</span>}
        {meta?.demo && !meta.keys_exhausted && <span className="chip bg-[var(--color-warning)] text-white">DEMO</span>}
      </div>
    </header>
  );
}

function MobileBottomNav({ nav, pathname }: { nav: NavEntry[]; pathname: string }) {
  return (
    <nav className="mobile-nav">
      {nav.slice(0, 4).map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium"
          style={{ color: isActive(pathname, href) ? "var(--color-brand)" : "var(--color-muted)" }}
        >
          <Icon size={20} />
          {label.split(" ")[0]}
        </Link>
      ))}
    </nav>
  );
}

function MobileNavDrawer({
  open, onClose, nav, pathname, userName, role,
}: { open: boolean; onClose: () => void; nav: NavEntry[]; pathname: string; userName: string; role: Role }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-0 top-0 flex h-full w-72 max-w-[80vw] flex-col bg-[#0f2942] py-4 text-white shadow-2xl">
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo2.png" alt="LabMind" className="h-8 w-8 rounded-lg object-contain" />
            <p className="font-bold">LabMind</p>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="text-white/60 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {userName && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="text-[11px] capitalize text-white/50">{role}</p>
            </div>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-item" data-active={isActive(pathname, href)} onClick={onClose}>
              <Icon size={19} className="shrink-0" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="px-3 pt-2">
          <button
            onClick={() => signOut({ callbackUrl: "/auth" })}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-white/30 hover:text-white/60"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
