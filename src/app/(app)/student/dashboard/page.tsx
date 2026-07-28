"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bot, BookOpen, FileText, FlaskConical, History, Loader2, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { loadSession } from "@/hooks/useSession";
import { ErrorState } from "@/components/ui/data-states";
import type { HistoryEntry } from "@/lib/types";

export default function StudentDashboard() {
  const { data: authSession } = useSession();
  const name = authSession?.user?.name ?? authSession?.user?.email ?? "Student";
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("labmind:session:")) {
        const id = key.replace("labmind:session:", "");
        const sess = loadSession(id);
        if (sess) { setSessionId(id); break; }
      }
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="hero-gradient anim-fade-up rounded-[var(--radius-card)] p-7 text-white">
        <p className="text-white/60">Welcome back</p>
        <h1 className="text-3xl font-extrabold">{name} 👋</h1>
        <p className="mt-1 text-white/75">Your AI lab partner is ready.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 anim-fade-up stagger-1">
        <DashCard
          href="/student/join"
          icon={PlusCircle}
          title="Join Session"
          desc="Enter the session code from your instructor to start a new experiment."
          cta="Join now"
          accent="brand"
        />
        {sessionId ? (
          <DashCard
            href={`/lab/${sessionId}`}
            icon={FlaskConical}
            title="Continue Experiment"
            desc="Pick up where you left off — your progress is saved."
            cta="Resume"
            accent="accent"
          />
        ) : (
          <DashCard
            href="/library"
            icon={BookOpen}
            title="Browse Library"
            desc="Explore the 3 available experiments and start one directly."
            cta="Browse"
            accent="navy"
          />
        )}
        <DashCard
          href="/assistant"
          icon={Bot}
          title="Ask LabMind"
          desc="Chat with the AI assistant — theory, safety, or procedure questions."
          cta="Open chat"
          accent="warning"
        />
        {sessionId ? (
          <DashCard
            href={`/lab/${sessionId}/report`}
            icon={FileText}
            title="My Report"
            desc="View and download your auto-generated lab report."
            cta="View report"
            accent="muted"
          />
        ) : (
          <DashCard
            href="/library"
            icon={History}
            title="My Experiments"
            desc="Start an experiment from the library to generate reports."
            cta="Browse"
            accent="muted"
          />
        )}
      </div>

      <PastExperiments />

      {/* How it works strip */}
      <div className="card p-5">
        <h3 className="mb-3 font-bold text-[var(--color-navy)]">How an experiment works</h3>
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            { n: "1", t: "Join", d: "Enter the session code from your instructor" },
            { n: "2", t: "Follow steps", d: "AI guides you through each step with safety checks" },
            { n: "3", t: "Upload proof", d: "Photo your readings — AI verifies them instantly" },
            { n: "4", t: "Get report", d: "Your full lab report is auto-generated at the end" },
          ].map((s) => (
            <div key={s.n} className="text-center">
              <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand)]/10 text-sm font-bold text-[var(--color-brand)]">{s.n}</div>
              <p className="text-sm font-bold text-[var(--color-navy)]">{s.t}</p>
              <p className="text-xs text-[var(--color-muted)]">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Real history, keyed to the student's account rather than this browser's
 * sessionStorage — so their record follows them across devices.
 */
function PastExperiments() {
  const { data: history = [], isLoading, isError, isPaused, refetch } = useQuery<HistoryEntry[]>({
    queryKey: ["student-history"],
    queryFn: async () => {
      const res = await fetch("/api/student/history", { cache: "no-store" });
      // A failed fetch must not silently resolve to an empty array — that
      // reads as "you have no history", not "this failed to load".
      if (!res.ok) throw new Error(`Failed to load history: ${res.status}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
  });

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-[var(--color-brand)]" />
      </div>
    );
  }

  if (isError || isPaused) {
    return <ErrorState title="Couldn't load your experiments" onRetry={() => refetch()} offline={isPaused} />;
  }

  if (history.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 py-10 text-center">
        <History size={30} className="text-[var(--color-muted)]" />
        <p className="font-semibold text-[var(--color-navy)]">No experiments yet</p>
        <p className="max-w-sm text-sm text-[var(--color-muted)]">
          Join a session or start one from the library — your completed experiments and scores
          will collect here.
        </p>
      </div>
    );
  }

  const completed = history.filter((h) => h.status === "completed");
  const accurate = completed.filter((h) => h.deviation_percent !== null && h.deviation_percent <= 5).length;

  return (
    <div className="card anim-fade-up stagger-2 space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-[var(--color-navy)]">My experiments</h3>
        <p className="font-data text-xs text-[var(--color-muted)]">
          {completed.length} completed
          {completed.length > 0 && ` · ${accurate} within 5% of expected`}
        </p>
      </div>

      <div className="space-y-2">
        {history.map((h, i) => {
          const done = h.status === "completed";
          const dev = h.deviation_percent;
          const devColor =
            dev === null ? "var(--color-muted)"
              : dev <= 2 ? "var(--color-accent)"
              : dev <= 10 ? "var(--color-warning)"
              : "var(--color-danger)";
          return (
            <Link
              key={h.session_id}
              href={done ? `/lab/${h.session_id}/report` : `/lab/${h.session_id}`}
              className="card-hover anim-fade-up flex items-center gap-3 rounded-[var(--radius-btn)] border border-black/[0.07] p-3"
              style={{ animationDelay: `${Math.min(i, 6) * 0.05}s` }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--color-navy)]">{h.experiment_name}</p>
                <p className="font-data text-xs text-[var(--color-muted)]">
                  {new Date(h.started_at).toLocaleDateString()} · {h.steps_completed}/{h.total_steps} steps
                  {h.safety_alert_count > 0 && ` · ${h.safety_alert_count} safety alert${h.safety_alert_count === 1 ? "" : "s"}`}
                  {h.override_count > 0 && ` · ${h.override_count} override${h.override_count === 1 ? "" : "s"}`}
                </p>
              </div>

              {dev !== null && (
                <div className="shrink-0 text-right">
                  <p className="font-data text-sm font-bold" style={{ color: devColor }}>{dev}%</p>
                  <p className="text-[10px] text-[var(--color-muted)]">deviation</p>
                </div>
              )}

              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  backgroundColor: done ? "var(--color-accent)" : "var(--color-brand)",
                  color: "#fff",
                }}
              >
                {done ? "Done" : "In progress"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DashCard({ href, icon: Icon, title, desc, cta, accent }: {
  href: string; icon: typeof Bot; title: string; desc: string; cta: string; accent: string;
}) {
  const bg: Record<string, string> = {
    brand: "bg-[var(--color-brand)] text-white",
    accent: "bg-[var(--color-accent)] text-white",
    navy: "bg-[var(--color-navy)] text-white",
    warning: "bg-[var(--color-warning)] text-white",
    muted: "bg-black/8 text-[var(--color-navy)]",
  };
  return (
    <Link href={href} className="card card-hover group flex flex-col gap-3 p-5">
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 ${bg[accent]}`}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className="font-bold text-[var(--color-navy)]">{title}</h3>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">{desc}</p>
      </div>
      <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]">
        {cta} <span className="transition-transform duration-200 group-hover:translate-x-1">→</span>
      </span>
    </Link>
  );
}
