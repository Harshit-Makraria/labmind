"use client";

/**
 * One student's complete experiment record.
 *
 * Everything on this page was already being stored — step timings, vision
 * readings, overrides, safety events, submitted photos, the audit chain — and
 * none of it was reachable. The instructor could see a progress bar and a
 * summary report; they could not see what the student actually did.
 *
 * Photos are fetched one at a time from /api/instructor/verifications/:id/image
 * rather than embedded in this payload: a record with a dozen photos would
 * otherwise be megabytes of base64 on every poll.
 */

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Camera, CheckCircle2, Clock, FileText,
  Loader2, ShieldAlert, SkipForward, X, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ErrorState } from "@/components/ui/data-states";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { api } from "@/lib/api-client";
import type { StudentPhoto } from "@/lib/types";

const fmtTime = (iso: string) => new Date(iso).toLocaleString();
const fmtDuration = (s: number | null) => {
  if (s === null) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
};

const STATUS_TONE: Record<string, { label: string; color: string }> = {
  auto_verified: { label: "Auto-verified", color: "var(--color-accent)" },
  approved: { label: "Approved by you", color: "var(--color-accent)" },
  pending: { label: "Awaiting your review", color: "var(--color-warning)" },
  rejected: { label: "Rejected by you", color: "var(--color-danger)" },
  failed: { label: "Didn't match the step", color: "var(--color-danger)" },
  retake: { label: "Too unclear to read", color: "var(--color-muted)" },
};

export default function StudentRecordPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [photo, setPhoto] = useState<StudentPhoto | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["student-record", sessionId],
    queryFn: () => api.studentRecord(sessionId),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center gap-2 text-[var(--color-muted)]">
        <Loader2 className="animate-spin" /> Loading the full record…
      </div>
    );
  }
  if (isError || !data) return <ErrorState title="Couldn't load this student's record" onRetry={() => refetch()} />;

  const completedSteps = data.steps.filter((s) => s.state === "completed").length;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/instructor/dashboard" className="inline-flex items-center gap-1 text-sm text-[var(--color-brand)] hover:underline">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[var(--color-navy)]">{data.student_name}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {data.experiment_name} · started {fmtTime(data.started_at)} · last activity {fmtTime(data.updated_at)}
        </p>
      </div>

      {/* ── Summary ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Progress" value={`${completedSteps}/${data.total_steps}`} sub={data.status} />
        <Stat
          label="Final result"
          value={data.student_result !== null ? String(data.student_result) : "—"}
          sub={data.deviation_percent !== null ? `${data.deviation_percent}% deviation` : "not submitted"}
        />
        <Stat label="Photos submitted" value={String(data.photos.length)} sub={`${data.photos.filter((p) => p.status === "rejected").length} rejected`} />
        <Stat
          label="Integrity"
          value={String(data.safety_alert_count + data.duplicate_photo_count)}
          sub={`${data.safety_alert_count} safety · ${data.duplicate_photo_count} duplicate`}
          tone={data.safety_alert_count + data.duplicate_photo_count > 0 ? "var(--color-danger)" : undefined}
        />
      </div>

      {(data.hypothesis || data.prelab_score !== null) && (
        <div className="card space-y-2 p-4">
          {data.prelab_score !== null && (
            <p className="text-sm">
              <span className="font-semibold text-[var(--color-navy)]">Pre-lab quiz:</span>{" "}
              <span className={data.prelab_passed ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}>
                {data.prelab_score}% — {data.prelab_passed ? "passed" : "failed"}
              </span>
            </p>
          )}
          {data.hypothesis && (
            <p className="text-sm">
              <span className="font-semibold text-[var(--color-navy)]">Hypothesis:</span>{" "}
              <span className="text-[var(--color-muted)]">{data.hypothesis}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Step-by-step ──────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-[var(--color-navy)]">Every step</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-[var(--color-surface)] text-left text-xs uppercase text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5">Step</th>
                  <th className="px-4 py-2.5">State</th>
                  <th className="px-4 py-2.5">Reading</th>
                  <th className="px-4 py-2.5">Attempts</th>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Completed</th>
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <tr key={s.step_number} className="border-b border-black/5">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--color-navy)]">{s.step_number}. {s.title}</p>
                      {s.expected_observation && <p className="text-xs text-[var(--color-muted)]">Expected: {s.expected_observation}</p>}
                      {s.manual_override && (
                        <p className="mt-0.5 text-xs text-[var(--color-warning)]">
                          Manually overridden — {s.manual_override.note || "no note"}
                        </p>
                      )}
                      {s.flagged && <p className="text-xs text-[var(--color-warning)]">Unreliable — an earlier step was skipped</p>}
                    </td>
                    <td className="px-4 py-3">
                      {s.state === "completed" ? (
                        <span className="inline-flex items-center gap-1 text-[var(--color-accent)]"><CheckCircle2 size={14} /> done</span>
                      ) : s.state === "skipped" ? (
                        <span className="inline-flex items-center gap-1 text-[var(--color-warning)]"><SkipForward size={14} /> skipped</span>
                      ) : (
                        <span className="text-[var(--color-muted)]">pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-data">
                      {s.vision_reading !== null ? s.vision_reading : s.manual_override?.value ?? "—"}
                      {s.vision_pass === false && <XCircle size={12} className="ml-1 inline text-[var(--color-danger)]" />}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{s.vision_attempts || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={s.pacing_flag ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-muted)]"}>
                        {fmtDuration(s.elapsed_seconds)}
                      </span>
                      {s.pacing_flag && <p className="text-xs text-[var(--color-danger)]">{s.pacing_flag.replace(/_/g, " ")}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-muted)]">
                      {s.completed_at ? fmtTime(s.completed_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Photo evidence ────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
          <Camera size={15} /> Submitted photos ({data.photos.length})
        </h2>
        {data.photos.length === 0 ? (
          <p className="card p-4 text-sm text-[var(--color-muted)]">No photos submitted yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.photos.map((p) => {
              const tone = STATUS_TONE[p.status] ?? { label: p.status, color: "var(--color-muted)" };
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPhoto(p)}
                  className="card overflow-hidden text-left transition-shadow hover:shadow-md"
                >
                  {p.has_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/instructor/verifications/${p.id}/image`}
                      alt={`Step ${p.step_number} — ${p.step_title}`}
                      loading="lazy"
                      className="h-32 w-full bg-[var(--color-surface)] object-cover"
                    />
                  ) : (
                    /* An entry recorded before images were retained, or stored
                       without one. Say so rather than showing a broken tile. */
                    <div className="flex h-32 w-full flex-col items-center justify-center gap-1 bg-[var(--color-surface)] text-[var(--color-muted)]">
                      <Camera size={18} />
                      <span className="text-xs">No image stored</span>
                    </div>
                  )}
                  <div className="p-2.5">
                    <p className="truncate text-xs font-semibold text-[var(--color-navy)]">
                      {p.step_number}. {p.step_title}
                    </p>
                    <p className="mt-0.5 text-xs font-medium" style={{ color: tone.color }}>{tone.label}</p>
                    <p className="text-xs text-[var(--color-muted)]">{fmtTime(p.submitted_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Safety & audit trail ──────────────────────────────── */}
      {(data.audit.length > 0 || data.safety_log.length > 0) && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <ShieldAlert size={15} /> Safety &amp; audit trail
          </h2>
          <div className="card divide-y divide-black/5">
            {data.audit.map((a, i) => (
              <div key={i} className="flex items-start gap-2 p-3">
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0"
                  style={{ color: a.severity === "high" || a.severity === "critical" ? "var(--color-danger)" : "var(--color-warning)" }}
                />
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-navy)]">Step {a.step_number} — {a.summary}</p>
                  <p className="text-xs text-[var(--color-muted)]">{a.severity} · {fmtTime(a.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.notes.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <FileText size={15} /> Instructor notes
          </h2>
          <div className="card divide-y divide-black/5">
            {data.notes.map((n, i) => <p key={i} className="p-3 text-sm text-[var(--color-navy)]">{n}</p>)}
          </div>
        </section>
      )}

      {photo && <PhotoModal photo={photo} onClose={() => setPhoto(null)} />}
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

function PhotoModal({ photo, onClose }: { photo: StudentPhoto; onClose: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);
  const tone = STATUS_TONE[photo.status] ?? { label: photo.status, color: "var(--color-muted)" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Photo for step ${photo.step_number}`}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
          <div>
            <p className="font-bold text-[var(--color-navy)]">Step {photo.step_number} — {photo.step_title}</p>
            <p className="text-xs" style={{ color: tone.color }}>{tone.label} · {fmtTime(photo.submitted_at)}</p>
          </div>
          <button onClick={onClose} aria-label="Close photo" className="rounded-lg p-1.5 hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        {photo.has_image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/instructor/verifications/${photo.id}/image`}
            alt={`Step ${photo.step_number} evidence`}
            className="max-h-[55dvh] w-full bg-black object-contain"
          />
        ) : (
          <p className="bg-[var(--color-surface)] p-8 text-center text-sm text-[var(--color-muted)]">
            No image was stored for this submission — the AI verdict below is still on record.
          </p>
        )}

        <div className="space-y-2 p-4 text-sm">
          <Row label="AI reading" value={photo.ai_reading !== null ? String(photo.ai_reading) : "none extracted"} />
          <Row label="AI confidence" value={`${Math.round(photo.ai_confidence * 100)}%`} />
          {photo.ai_message && <Row label="AI verdict" value={photo.ai_message} />}
          {photo.instructor_comment && <Row label="Your comment" value={photo.instructor_comment} />}
          {photo.resolved_at && <Row label="Resolved" value={fmtTime(photo.resolved_at)} />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-2">
      <span className="shrink-0 font-semibold text-[var(--color-navy)]">{label}:</span>
      <span className="text-[var(--color-muted)]">{value}</span>
    </p>
  );
}
