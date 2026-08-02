"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Eye, FlaskConical, PlusCircle, SkipForward, Users, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/data-states";
import { api, fetchJson, isForbidden } from "@/lib/api-client";
import type { InstructorSession, SessionSummary, SkipRequestSummary } from "@/lib/types";

export default function InstructorDashboard() {
  const qc = useQueryClient();
  const [filterRequire, setFilterRequire] = useState(false);
  const { data: skipRequests } = useQuery<SkipRequestSummary[]>({
    queryKey: ["skip-requests"],
    queryFn: () => api.skipRequests(),
    // A live 60s countdown is only useful if this stays close to real-time.
    refetchInterval: 3000,
  });
  const respondToSkip = useMutation({
    mutationFn: ({ sessionId, action }: { sessionId: string; action: "approve" | "deny" }) =>
      action === "approve" ? api.approveSkipRequest(sessionId) : api.denySkipRequest(sessionId),
    onSuccess: (_res, { action }) => {
      qc.invalidateQueries({ queryKey: ["skip-requests"] });
      toast.success(action === "approve" ? "Skip approved" : "Skip denied");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't respond to the request — it may have expired"),
  });
  const { data: instrSessions, isError: sessionsErrored, isPaused: sessionsPaused, error: sessionsError, failureReason: sessionsFailureReason, refetch: refetchSessions } = useQuery<InstructorSession[]>({
    queryKey: ["instructor-sessions"],
    queryFn: () => fetchJson<InstructorSession[]>("/api/instructor/sessions"),
    refetchInterval: 5000,
  });
  const { data: students, isError: studentsErrored, isPaused: studentsPaused, error: studentsError, failureReason: studentsFailureReason, refetch: refetchStudents } = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: () => fetchJson<SessionSummary[]>("/api/dashboard/sessions"),
    refetchInterval: 5000,
  });
  const { data: verifyList } = useQuery<{ length: number }>({
    queryKey: ["verify-count"],
    queryFn: () => fetchJson("/api/instructor/verify?status=pending"),
    refetchInterval: 4000,
  });

  if (sessionsErrored || studentsErrored || sessionsPaused || studentsPaused) {
    // A genuinely non-ok response (401/403) can still leave TanStack Query in
    // fetchStatus "paused"/status "pending" rather than settling to isError —
    // observed with networkMode:"online" retries — so isError/error alone
    // aren't reliable here. failureReason holds the real error from the last
    // attempt regardless of that paused state, so check it too.
    const forbidden = isForbidden(sessionsError) || isForbidden(studentsError)
      || isForbidden(sessionsFailureReason) || isForbidden(studentsFailureReason);
    return (
      <ErrorState
        title="Couldn't load your dashboard"
        message="Sessions or student data failed to load. Student devices keep recording locally regardless."
        onRetry={() => { refetchSessions(); refetchStudents(); }}
        offline={!forbidden && (sessionsPaused || studentsPaused)}
        forbidden={forbidden}
      />
    );
  }

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

      {/* Skip requests — students can't self-skip in an instructor-led
          session; each request needs a response inside a 60s window. */}
      {!!skipRequests?.length && (
        <section className="card anim-fade-up space-y-2.5 border-l-[3px] border-[var(--color-brand)] p-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <SkipForward size={15} className="text-[var(--color-brand)]" /> Skip requests waiting on you
          </p>
          <div className="space-y-2">
            {skipRequests.map((r) => (
              <div key={r.session_id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-btn)] bg-black/[0.03] px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-navy)]">
                    {r.student_name} — Step {r.step_number}
                  </p>
                  <p className="font-data text-xs text-[var(--color-muted)]">{r.seconds_remaining}s left to respond</p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={respondToSkip.isPending}
                    onClick={() => respondToSkip.mutate({ sessionId: r.session_id, action: "approve" })}
                    className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <CheckCircle2 size={13} /> Approve
                  </button>
                  <button
                    disabled={respondToSkip.isPending}
                    onClick={() => respondToSkip.mutate({ sessionId: r.session_id, action: "deny" })}
                    className="flex items-center gap-1 rounded-lg border border-black/12 bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-navy)] disabled:opacity-50"
                  >
                    <X size={13} /> Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sessions table */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--color-navy)]">Recent sessions</h2>
          <Link href="/instructor/create-session" className="text-sm font-semibold text-[var(--color-brand)] hover:underline">
            + New session
          </Link>
        </div>
        <div className="card overflow-hidden p-0">
          {/* This table used to just clip past its card boundary on a narrow
              phone (overflow-hidden on the card, no scroll container) —
              columns past "Status" were silently cut off, not just visually
              cramped. Scrolling the table itself inside the still-rounded
              card keeps every column reachable. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
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
