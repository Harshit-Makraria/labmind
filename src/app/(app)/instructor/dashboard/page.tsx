"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Eye, FlaskConical, PlusCircle, Users } from "lucide-react";
import Link from "next/link";
import type { InstructorSession, SessionSummary } from "@/lib/types";

export default function InstructorDashboard() {
  const [filterRequire, setFilterRequire] = useState(false);
  const { data: instrSessions } = useQuery<InstructorSession[]>({
    queryKey: ["instructor-sessions"],
    queryFn: async () => (await fetch("/api/instructor/sessions", { cache: "no-store" })).json(),
    refetchInterval: 5000,
  });
  const { data: students } = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: async () => (await fetch("/api/dashboard/sessions", { cache: "no-store" })).json(),
    refetchInterval: 5000,
  });
  const { data: verifyList } = useQuery<{ length: number }>({
    queryKey: ["verify-count"],
    queryFn: async () => (await fetch("/api/instructor/verify?status=pending", { cache: "no-store" })).json(),
    refetchInterval: 4000,
  });

  const sessions = (instrSessions ?? []).filter((s) => (filterRequire ? s.require_verification : true));
  const allStudents = students ?? [];
  const pending = Array.isArray(verifyList) ? verifyList.length : 0;
  const completed = allStudents.filter((s) => s.status === "completed").length;
  const avgProgress = allStudents.length
    ? Math.round(allStudents.reduce((a, s) => a + (s.current_step / s.total_steps) * 100, 0) / allStudents.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI icon={Users} label="Students joined" value={allStudents.length} color="brand" />
        <KPI icon={CheckCircle2} label="Completed" value={completed} color="accent" />
        <KPI icon={ClipboardList} label="Pending verifications" value={pending} color={pending > 0 ? "warning" : "muted"} />
        <KPI icon={FlaskConical} label="Avg progress" value={`${avgProgress}%`} color="navy" />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/instructor/create-session">
          <button className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-navy)] px-5 py-2.5 font-semibold text-white hover:bg-[var(--color-navy-700)]">
            <PlusCircle size={18} /> Create Session
          </button>
        </Link>
        <Link href="/instructor/verify">
          <button className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-5 py-2.5 font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]">
            <ClipboardList size={18} /> Verification Queue {pending > 0 && <span className="rounded-full bg-[var(--color-warning)] px-2 py-0.5 text-xs text-white">{pending}</span>}
          </button>
        </Link>
        <label className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-4 py-2.5 font-semibold text-[var(--color-navy)]">
          <input type="checkbox" checked={filterRequire} onChange={(e) => setFilterRequire(e.target.checked)} />
          <span className="text-sm">Only require-verification</span>
        </label>
        <Link href="/dashboard">
          <button className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-5 py-2.5 font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]">
            <Eye size={18} /> Live Monitor
          </button>
        </Link>
      </div>

      {/* Sessions table */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--color-navy)]">Recent sessions</h2>
          <Link href="/instructor/create-session" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">
            + New session
          </Link>
        </div>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-black/8 bg-[var(--color-surface)]">
              <tr>
                {["Session name", "Experiment", "Code", "Students", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-[var(--color-muted)]">No sessions yet. <Link href="/instructor/create-session" className="text-[var(--color-brand)] underline">Create one →</Link></td></tr>
              )}
              {sessions.map((sess) => (
                <tr key={sess.code} className="border-b border-black/5 hover:bg-[var(--color-surface)]/50">
                  <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{sess.session_name}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{sess.experiment_name}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-[var(--color-brand)]">{sess.code}</span>
                  </td>
                  <td className="px-4 py-3">{sess.student_session_ids.length}</td>
                  <td className="px-4 py-3">
                    <span className="chip bg-[var(--color-accent)]/12 text-[var(--color-accent)]">Active</span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/instructor/session/${sess.code}`} className="flex items-center gap-1 text-[var(--color-brand)] hover:underline">
                      Monitor <ArrowRight size={13} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Student overview */}
      {allStudents.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--color-navy)]">Live student overview</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allStudents.slice(0, 6).map((s) => (
              <div key={s.session_id} className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-[var(--color-navy)]">{s.student_name}</p>
                  <span className={`chip text-white ${s.status === "safety_alert" ? "bg-[var(--color-danger)]" : s.status === "completed" ? "bg-[var(--color-accent)]" : "bg-[var(--color-brand)]"}`}>
                    {s.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-muted)]">Step {s.current_step}/{s.total_steps} · {s.experiment_name}</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/8">
                  <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${(s.current_step / s.total_steps) * 100}%` }} />
                </div>
                {s.safety_alert_count > 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--color-danger)]">
                    <AlertTriangle size={12} /> {s.safety_alert_count} safety alert
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KPI({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    brand: "text-[var(--color-brand)] bg-[var(--color-brand)]/10",
    accent: "text-[var(--color-accent)] bg-[var(--color-accent)]/12",
    warning: "text-[var(--color-warning)] bg-[var(--color-warning)]/12",
    muted: "text-[var(--color-muted)] bg-black/5",
    navy: "text-[var(--color-navy)] bg-[var(--color-navy)]/8",
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xl font-extrabold text-[var(--color-navy)]">{value}</p>
        <p className="text-xs text-[var(--color-muted)]">{label}</p>
      </div>
    </div>
  );
}
