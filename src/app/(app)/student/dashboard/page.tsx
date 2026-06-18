"use client";

import { useEffect, useState } from "react";
import { Bot, BookOpen, FileText, FlaskConical, History, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { loadSession } from "@/hooks/useSession";

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
      <div className="hero-gradient rounded-[var(--radius-card)] p-7 text-white">
        <p className="text-white/60">Welcome back</p>
        <h1 className="text-3xl font-extrabold">{name} 👋</h1>
        <p className="mt-1 text-white/75">Your AI lab partner is ready.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
    <Link href={href} className="card flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${bg[accent]}`}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className="font-bold text-[var(--color-navy)]">{title}</h3>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">{desc}</p>
      </div>
      <span className="mt-auto text-sm font-semibold text-[var(--color-brand)]">{cta} →</span>
    </Link>
  );
}
