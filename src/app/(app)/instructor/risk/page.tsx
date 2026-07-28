"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Gauge, ShieldCheck, Timer, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState } from "@/components/ui/data-states";
import type { InstructorSession, RiskAssessment } from "@/lib/types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

const BAND: Record<RiskAssessment["band"], { bg: string; fg: string; label: string }> = {
  high:     { bg: "var(--color-danger)",  fg: "#fff", label: "High" },
  elevated: { bg: "var(--color-warning)", fg: "#fff", label: "Elevated" },
  moderate: { bg: "var(--color-brand)",   fg: "#fff", label: "Moderate" },
  low:      { bg: "var(--color-accent)",  fg: "#fff", label: "On track" },
};

export default function RiskPage() {
  const [code, setCode] = useState<string>("");

  const { data: sessions = [] } = useQuery<InstructorSession[]>({
    queryKey: ["instructor-sessions"],
    queryFn: () => getJson("/api/instructor/sessions"),
  });

  const active = code || sessions[0]?.code || "";

  const { data: students = [], isLoading, isError, isPaused, refetch } = useQuery<RiskAssessment[]>({
    queryKey: ["risk", active],
    queryFn: () => getJson(`/api/instructor/sessions/${active}/risk`),
    enabled: !!active,
    refetchInterval: 5000,
  });

  const needsAttention = students.filter((s) => s.band === "high" || s.band === "elevated");

  if (isError || isPaused) {
    return <ErrorState title="Couldn't load risk data" onRetry={() => refetch()} offline={isPaused} />;
  }

  return (
    <div className="space-y-5">
      <div className="anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Who needs you first</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Students ranked by risk, so your attention goes where it matters. Each student&apos;s
            auto-verification bar adapts to their record.
          </p>
        </div>
        {sessions.length > 0 && (
          <select
            value={active}
            onChange={(e) => setCode(e.target.value)}
            className="input-base min-w-[200px]"
          >
            {sessions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.session_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {sessions.length === 0 && (
        <EmptyState
          title="No sessions yet"
          body="Create a session and share the code with your students — risk ranking appears as they work."
          href="/instructor/create-session"
          cta="Create a session"
        />
      )}

      {active && !isLoading && students.length === 0 && (
        <EmptyState
          title="No students have joined yet"
          body={`Share code ${active} with your class. This list updates live as they work.`}
        />
      )}

      {needsAttention.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius-btn)] bg-[var(--color-danger)]/8 px-4 py-3 text-sm">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
          <p className="text-[var(--color-navy)]">
            <strong>{needsAttention.length}</strong> student{needsAttention.length === 1 ? "" : "s"} need
            attention. Start at the top of the list.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {students.map((s, i) => <RiskRow key={s.session_id} s={s} index={i} />)}
      </div>
    </div>
  );
}

function RiskRow({ s, index }: { s: RiskAssessment; index: number }) {
  const band = BAND[s.band];
  const progress = s.total_steps ? Math.round((s.current_step / s.total_steps) * 100) : 0;

  return (
    <div
      className={`card card-hover anim-fade-up space-y-3 p-4 ${s.band === "high" ? "alert-ring" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-[var(--color-navy)]">{s.student_name}</p>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: band.bg, color: band.fg }}
            >
              {band.label}
            </span>
            {s.pacing_verdict === "implausible" && (
              <span className="flex items-center gap-1 rounded-full bg-[var(--color-danger)]/12 px-2 py-0.5 text-[11px] font-bold text-[var(--color-danger)]">
                <Timer size={11} /> Pacing implausible
              </span>
            )}
          </div>
          <p className="font-data mt-0.5 text-xs text-[var(--color-muted)]">
            Step {s.current_step} of {s.total_steps} · {progress}% complete
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-data text-2xl font-bold leading-none" style={{ color: band.bg }}>{s.score}</p>
          <p className="text-[11px] text-[var(--color-muted)]">risk score</p>
        </div>
      </div>

      {s.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.factors.map((f) => (
            <span
              key={f.code}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                f.weight < 0
                  ? "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"
                  : "bg-black/[0.04] text-[var(--color-navy)]"
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-2.5">
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Gauge size={13} />
          Auto-verify bar for this student:{" "}
          <strong className="font-data text-[var(--color-navy)]">{Math.round(s.verification_threshold * 100)}%</strong>
        </p>
        <Link
          href={`/lab/${s.session_id}/integrity`}
          className="group flex items-center gap-0.5 text-xs font-semibold text-[var(--color-brand)] hover:underline"
        >
          View timeline <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <p className="text-xs text-[var(--color-muted)]">{s.recommendation}</p>
    </div>
  );
}

function EmptyState({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-12 text-center">
      <ShieldCheck size={38} className="text-[var(--color-accent)]" />
      <p className="font-semibold text-[var(--color-navy)]">{title}</p>
      <p className="max-w-sm text-sm text-[var(--color-muted)]">{body}</p>
      {href && cta && (
        <Link href={href} className="btn-primary mt-1 inline-flex items-center gap-2">
          <Users size={15} /> {cta}
        </Link>
      )}
    </div>
  );
}
