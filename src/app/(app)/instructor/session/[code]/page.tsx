"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download,
  FlaskConical, RefreshCw, ShieldAlert, Target, Users,
} from "lucide-react";
import Link from "next/link";
import { use } from "react";
import type { SessionSummary, InstructorSession } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  active: "bg-[var(--color-brand)] text-white",
  completed: "bg-[var(--color-accent)] text-white",
  safety_alert: "bg-[var(--color-danger)] text-white",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Running",
  completed: "Completed",
  safety_alert: "⚠ Safety Alert",
};

export default function SessionDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);

  const { data: session } = useQuery<InstructorSession>({
    queryKey: ["instructor-session", code],
    queryFn: async () => (await fetch(`/api/instructor/sessions/${code}`)).json(),
  });

  const { data: students = [], dataUpdatedAt } = useQuery<SessionSummary[]>({
    queryKey: ["session-students", code],
    queryFn: async () => (await fetch(`/api/instructor/sessions/${code}/students`, { cache: "no-store" })).json(),
    refetchInterval: 3000,
  });

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";
  const completed = students.filter((s) => s.status === "completed").length;
  const alerts = students.reduce((n, s) => n + s.safety_alert_count, 0);
  const avgProgress = students.length
    ? Math.round(students.reduce((a, s) => a + (s.current_step / s.total_steps) * 100, 0) / students.length)
    : 0;
  const avgDeviation = (() => {
    const with_dev = students.filter((s) => s.deviation_percent !== null);
    if (!with_dev.length) return null;
    return Math.round(with_dev.reduce((a, s) => a + (s.deviation_percent ?? 0), 0) / with_dev.length * 10) / 10;
  })();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/instructor/dashboard" className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-navy)]">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">{session?.session_name ?? code}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--color-muted)]">
            <span className="font-mono font-bold text-[var(--color-brand)]">{code}</span>
            {session?.experiment_name && <span>· {session.experiment_name}</span>}
            {session?.batch && <span>· Batch {session.batch}</span>}
            {session?.department && <span>· {session.department}</span>}
            {session?.date && <span>· {session.date}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <RefreshCw size={12} className="animate-spin" /> {lastUpdate}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI icon={Users} label="Students" value={students.length} color="navy" />
        <KPI icon={CheckCircle2} label="Completed" value={completed} color="accent" />
        <KPI icon={Target} label="Avg progress" value={`${avgProgress}%`} color="brand" />
        <KPI icon={ShieldAlert} label="Safety alerts" value={alerts} color={alerts > 0 ? "danger" : "muted"} />
      </div>

      {/* Progress distribution */}
      {students.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-4 font-bold text-[var(--color-navy)]">Student progress</h3>
          <div className="space-y-3">
            {students.map((s) => {
              const pct = Math.round((s.current_step / s.total_steps) * 100);
              return (
                <div key={s.session_id} className="flex items-center gap-3">
                  <div className="w-32 shrink-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-navy)]">{s.student_name}</p>
                    <p className="text-xs text-[var(--color-muted)]">Step {s.current_step}/{s.total_steps}</p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/8">
                      <div
                        className={`h-full rounded-full transition-all ${s.status === "safety_alert" ? "bg-[var(--color-danger)]" : s.status === "completed" ? "bg-[var(--color-accent)]" : "bg-[var(--color-brand)]"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-10 text-right text-xs font-bold text-[var(--color-navy)]">{pct}%</span>
                  <span className={`chip shrink-0 text-xs ${STATUS_COLOR[s.status] ?? "bg-black/10 text-[var(--color-navy)]"}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed table */}
      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-3">
          <h3 className="font-bold text-[var(--color-navy)]">All students</h3>
          {avgDeviation !== null && (
            <span className="text-xs text-[var(--color-muted)]">Avg deviation: <strong>{avgDeviation}%</strong></span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)]">
            <tr>
              {["Student", "Progress", "Deviation", "Safety", "Overrides", "Report"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[var(--color-muted)]">
                  <FlaskConical className="mx-auto mb-2 opacity-30" size={28} />
                  Waiting for students to join with code <strong className="font-mono text-[var(--color-brand)]">{code}</strong>
                </td>
              </tr>
            )}
            {students.map((s) => (
              <tr key={s.session_id} className="border-b border-black/5 hover:bg-[var(--color-surface)]/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-[var(--color-navy)]">{s.student_name}</p>
                  <p className="text-xs text-[var(--color-muted)]">{s.experiment_name}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/8">
                      <div className="h-full rounded-full bg-[var(--color-brand)]" style={{ width: `${(s.current_step / s.total_steps) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold">{s.current_step}/{s.total_steps}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  {s.deviation_percent !== null
                    ? <span className={s.deviation_percent > 10 ? "text-[var(--color-danger)] font-semibold" : "text-[var(--color-accent)] font-semibold"}>{s.deviation_percent}%</span>
                    : <span className="text-[var(--color-muted)]">—</span>}
                </td>
                <td className="px-4 py-3">
                  {s.safety_alert_count > 0
                    ? <span className="flex items-center gap-1 text-xs text-[var(--color-danger)]"><AlertTriangle size={13} /> {s.safety_alert_count}</span>
                    : s.last_vision_pass === false
                      ? <span className="flex items-center gap-1 text-xs text-[var(--color-warning)]"><Clock size={13} /> vision pending</span>
                      : <CheckCircle2 size={14} className="text-[var(--color-accent)]" />}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--color-muted)]">{s.override_count ?? 0}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/lab/${s.session_id}/report`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand)] hover:underline"
                  >
                    <Download size={13} /> Report
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Analytics summary */}
      {students.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <AnalyticsCard
            title="Completion rate"
            value={`${students.length ? Math.round((completed / students.length) * 100) : 0}%`}
            sub={`${completed} of ${students.length} students`}
            color="accent"
          />
          <AnalyticsCard
            title="Safety incidents"
            value={String(alerts)}
            sub={alerts === 0 ? "No incidents — great session!" : `Across ${students.filter((s) => s.safety_alert_count > 0).length} student(s)`}
            color={alerts > 0 ? "danger" : "accent"}
          />
          <AnalyticsCard
            title="Manual overrides"
            value={String(students.reduce((a, s) => a + (s.override_count ?? 0), 0))}
            sub="Vision checks bypassed"
            color="warning"
          />
        </div>
      )}
    </div>
  );
}

function KPI({ icon: Icon, label, value, color }: { icon: typeof Users; label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    navy: "text-[var(--color-navy)] bg-[var(--color-navy)]/8",
    brand: "text-[var(--color-brand)] bg-[var(--color-brand)]/10",
    accent: "text-[var(--color-accent)] bg-[var(--color-accent)]/12",
    warning: "text-[var(--color-warning)] bg-[var(--color-warning)]/12",
    danger: "text-[var(--color-danger)] bg-[var(--color-danger)]/10",
    muted: "text-[var(--color-muted)] bg-black/5",
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xl font-extrabold text-[var(--color-navy)]">{value}</p>
        <p className="text-xs text-[var(--color-muted)]">{label}</p>
      </div>
    </div>
  );
}

function AnalyticsCard({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    accent: "text-[var(--color-accent)]",
    danger: "text-[var(--color-danger)]",
    warning: "text-[var(--color-warning)]",
  };
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-[var(--color-muted)]">{title}</p>
      <p className={`mt-1 text-3xl font-extrabold ${colors[color] ?? "text-[var(--color-navy)]"}`}>{value}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{sub}</p>
    </div>
  );
}
