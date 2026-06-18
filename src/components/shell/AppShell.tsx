"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bot, ClipboardList, FlaskConical, LayoutDashboard, Loader2,
  type LucideIcon, Menu, Microscope, PanelLeft,
  PanelLeftClose, PlusCircle, Settings, Users,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { DemoBanner } from "@/components/DemoBanner";

type Role = "instructor" | "student" | null;

interface NavEntry { href: string; label: string; icon: LucideIcon }

const INSTRUCTOR_NAV: NavEntry[] = [
  { href: "/instructor/dashboard", label: "Dashboard",           icon: LayoutDashboard },
  { href: "/instructor/create-session", label: "Create Session", icon: PlusCircle },
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
  if (path.includes("/instructor/reports"))      return "Reports";
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

  // Redirect to login if not authenticated
  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-brand)]" />
      </div>
    );
  }
  if (status === "unauthenticated") {
    router.replace("/auth");
    return null;
  }

  const role = (session?.user?.role ?? "student") as Role;
  const userName = session?.user?.name ?? session?.user?.email ?? "";
  const nav = role === "instructor" ? INSTRUCTOR_NAV : STUDENT_NAV;

  return (
    <div className="shell" data-collapsed={collapsed}>
      <aside className="sidebar">
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl overflow-hidden shadow">
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
        <Topbar title={titleFor(pathname)} role={role} />
        <DemoBanner />
        <div className="content">{children}</div>
      </div>

      <MobileBottomNav nav={nav} pathname={pathname} />
    </div>
  );
}

function Topbar({ title, role }: { title: string; role: Role }) {
  const { data } = useQuery({
    queryKey: ["meta"],
    queryFn: async () => (await fetch("/api/meta", { cache: "no-store" })).json() as Promise<{ provider: string; demo: boolean; keys_exhausted: boolean }>,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return (
    <header className="glass-topbar flex items-center justify-between px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <button className="md:hidden text-[var(--color-navy)]" aria-label="Menu">
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
          <Bot size={13} /> {data?.provider ?? "…"}
        </span>
        {data?.keys_exhausted && <span className="chip bg-red-500 text-white">KEY LIMIT</span>}
        {data?.demo && !data.keys_exhausted && <span className="chip bg-[var(--color-warning)] text-white">DEMO</span>}
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
