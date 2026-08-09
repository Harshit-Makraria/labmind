"use client";

/**
 * Class-wide analytics for one session.
 *
 * The session page already showed live per-student progress. What it couldn't
 * answer was the question an instructor actually asks between labs: how did the
 * class as a whole do, and which step is causing the trouble? Every number here
 * is derived from data the app was already recording.
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, Loader2, TrendingUp, Users } from "lucide-react";
import { api } from "@/lib/api-client";

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
const fmtDuration = (s: number | null) => {
  if (s === null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
};

export function SessionAnalytics({ code }: { code: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["session-analytics", code],
    queryFn: () => api.sessionAnalytics(code),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Loader2 size={15} className="animate-spin" /> Building analytics…
      </div>
    );
  }
  // Silent when unavailable — the live student table above is the primary view
  // and must not be blocked by a secondary panel failing.
  if (isError || !data) return null;

  return (
    <div className="space-y-4">
      {/* Participation */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
          <Users size={15} /> Participation
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Students joined" value={String(data.students_joined)} />
          <Stat label="Completed" value={String(data.students_completed)} sub={pct(data.completion_rate)} tone="var(--color-accent)" />
          <Stat label="In progress" value={String(data.students_active)} />
          <Stat label="Not started" value={String(data.students_not_started)} tone={data.students_not_started > 0 ? "var(--color-warning)" : undefined} />
        </div>
      </div>

      {/* Results */}
      {data.results_recorded > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <TrendingUp size={15} /> Results
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Results submitted" value={String(data.results_recorded)} />
            <Stat label="Average deviation" value={data.avg_deviation !== null ? `${data.avg_deviation}%` : "—"} />
            <Stat label="Median deviation" value={data.median_deviation !== null ? `${data.median_deviation}%` : "—"} sub="less skewed by outliers" />
            <Stat label="Within 5%" value={`${data.within_5_percent}/${data.results_recorded}`} tone="var(--color-accent)" />
          </div>
        </div>
      )}

      {/* Evidence & integrity */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
          <Camera size={15} /> Evidence &amp; integrity
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Photos submitted" value={String(data.photos_submitted)} sub={`${data.photos_auto_verified} auto-verified`} />
          <Stat label="Awaiting review" value={String(data.photos_pending_review)} tone={data.photos_pending_review > 0 ? "var(--color-warning)" : undefined} />
          <Stat label="Rejected" value={String(data.photos_rejected)} tone={data.photos_rejected > 0 ? "var(--color-danger)" : undefined} />
          <Stat
            label="Integrity flags"
            value={String(data.duplicate_photos + data.pacing_flags)}
            sub={`${data.duplicate_photos} duplicate · ${data.pacing_flags} pacing`}
            tone={data.duplicate_photos + data.pacing_flags > 0 ? "var(--color-danger)" : undefined}
          />
        </div>
      </div>

      {/* Where the class struggled — the actionable bit */}
      {data.hardest_steps.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <AlertTriangle size={15} /> Where the class struggled
          </h3>
          <div className="card divide-y divide-black/5">
            {data.hardest_steps.map((s) => (
              <div key={s.step_number} className="p-3">
                <p className="text-sm font-semibold text-[var(--color-navy)]">Step {s.step_number} — {s.title}</p>
                <p className="text-xs text-[var(--color-muted)]">{s.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-step table */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-[var(--color-navy)]">Step-by-step breakdown</h3>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-[var(--color-surface)] text-left text-xs uppercase text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5">Step</th>
                  <th className="px-4 py-2.5">Completed</th>
                  <th className="px-4 py-2.5">On it now</th>
                  <th className="px-4 py-2.5">Photos</th>
                  <th className="px-4 py-2.5">Overrides</th>
                  <th className="px-4 py-2.5">Median time</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s.step_number} className="border-b border-black/5">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-[var(--color-navy)]">{s.step_number}. {s.title}</span>
                      {s.skipped > 0 && <span className="ml-2 text-xs text-[var(--color-warning)]">{s.skipped} skipped</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {s.completed}
                      {data.students_joined > 0 && (
                        <span className="ml-1 text-xs text-[var(--color-muted)]">
                          ({Math.round((s.completed / data.students_joined) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{s.in_progress || "—"}</td>
                    <td className="px-4 py-2.5">
                      {s.photo_attempts === 0 ? (
                        <span className="text-[var(--color-muted)]">—</span>
                      ) : (
                        <span>
                          {s.photo_attempts}
                          {s.photo_failed > 0 && <span className="ml-1 text-xs text-[var(--color-danger)]">{s.photo_failed} rejected</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{s.manual_overrides || "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{fmtDuration(s.median_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {data.prelab_taken > 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          Pre-lab quiz: {data.prelab_taken} taken, {data.prelab_passed} passed
          {data.avg_prelab_score !== null && ` · average ${data.avg_prelab_score}%`}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <p className="text-xs font-medium text-[var(--color-muted)]">{label}</p>
      <p className="font-data text-xl font-extrabold" style={{ color: tone ?? "var(--color-navy)" }}>{value}</p>
      {sub && <p className="text-xs text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}
