"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, MessageSquare, Target, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AccuracyReport, VerificationEntry } from "@/lib/types";

export default function VerifyPage() {
  const qc = useQueryClient();
  const { data } = useQuery<VerificationEntry[]>({
    queryKey: ["verifications"],
    queryFn: async () => {
      const res = await fetch("/api/instructor/verify", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load verifications: ${res.status}`);
      const json = await res.json();
      return Array.isArray(json) ? json : [];
    },
    refetchInterval: 4000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: "approved" | "rejected"; comment?: string }) => {
      const res = await fetch("/api/instructor/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id, status, comment }),
      });
      if (!res.ok) throw new Error("Failed to save decision");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["verifications"] }); toast.success("Decision saved"); },
    onError: (e) => toast.error((e as Error).message),
  });

  const { data: accuracy } = useQuery<AccuracyReport>({
    queryKey: ["vision-accuracy"],
    queryFn: async () => (await fetch("/api/instructor/accuracy", { cache: "no-store" })).json(),
    refetchInterval: 10_000,
  });

  const entries = Array.isArray(data) ? data : [];
  const pending = entries.filter((v) => v.status === "pending");
  const resolved = entries.filter((v) => v.status !== "pending");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-navy)]">Verification Queue</h2>
        <p className="text-sm text-[var(--color-muted)]">Student photo submissions requiring your review</p>
      </div>

      <AccuracyCard report={accuracy} />

      {pending.length === 0 && (
        <div className="card flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 size={40} className="text-[var(--color-accent)]" />
          <p className="font-semibold text-[var(--color-navy)]">No pending verifications</p>
          <p className="text-sm text-[var(--color-muted)]">New submissions will appear here automatically.</p>
        </div>
      )}

      <div className="space-y-3">
        {pending.map((v) => <VerifyCard key={v.id} v={v} onResolve={(status, comment) => resolve.mutate({ id: v.id, status, comment })} />)}
      </div>

      {resolved.length > 0 && (
        <>
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-muted)]">Resolved</h3>
          <div className="space-y-2">
            {resolved.map((v) => (
              <div key={v.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold text-[var(--color-navy)]">{v.student_name} — Step {v.step_number}</p>
                  <p className="text-xs text-[var(--color-muted)]">{new Date(v.submitted_at).toLocaleString()}</p>
                  {v.instructor_comment && <p className="mt-1 text-sm text-[var(--color-muted)]">Note: {v.instructor_comment}</p>}
                </div>
                <span className={`chip text-white ${v.status === "approved" ? "bg-[var(--color-accent)]" : "bg-[var(--color-danger)]"}`}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Live measured accuracy. Every decision below feeds this — it is the AI's
 * agreement rate against the instructor's own rulings, not a claim.
 */
function AccuracyCard({ report }: { report?: AccuracyReport }) {
  if (!report || report.resolved === 0) {
    return (
      <div className="card flex items-center gap-3 p-4 text-sm text-[var(--color-muted)]">
        <Target size={18} className="shrink-0 text-[var(--color-brand)]" />
        <span>
          Vision accuracy will appear here once you have reviewed a few submissions — it is measured
          against your own approve/reject decisions.
        </span>
      </div>
    );
  }

  const agreementPct = Math.round((report.agreement ?? 0) * 100);
  const tone = agreementPct >= 90 ? "var(--color-accent)" : agreementPct >= 75 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
            <Target size={15} /> Measured vision accuracy
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            Agreement with your decisions across {report.resolved} reviewed submission{report.resolved === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none" style={{ color: tone }}>{agreementPct}%</p>
          <p className="text-[11px] text-[var(--color-muted)]">{report.approved} approved · {report.rejected} rejected</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {report.byConfidence.map((b) => (
          <div key={b.label} className="rounded-lg bg-black/[0.03] px-3 py-2">
            <p className="text-[11px] font-semibold text-[var(--color-muted)]">{b.label}</p>
            <p className="text-sm font-bold text-[var(--color-navy)]">
              {b.agreement === null ? "—" : `${Math.round(b.agreement * 100)}%`}
              <span className="ml-1 text-[11px] font-normal text-[var(--color-muted)]">({b.total})</span>
            </p>
          </div>
        ))}
      </div>

      {report.confidentMisses > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--color-danger)]/8 px-3 py-2 text-xs text-[var(--color-danger)]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <strong>{report.confidentMisses}</strong> high-confidence reading{report.confidentMisses === 1 ? " was" : "s were"} rejected —
            worth lowering the auto-verify threshold.
          </span>
        </p>
      )}
    </div>
  );
}

function VerifyCard({ v, onResolve }: { v: VerificationEntry; onResolve: (s: "approved" | "rejected", c?: string) => void }) {
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const confidencePct = Math.round(v.ai_confidence * 100);
  const isLow = v.ai_confidence < 0.7;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-[var(--color-navy)]">{v.student_name}</p>
          <p className="text-sm text-[var(--color-muted)]">Step {v.step_number} · {new Date(v.submitted_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Clock size={13} /> Pending
        </div>
      </div>

      {/* AI findings */}
      <div className={`rounded-xl p-3 text-sm ${isLow ? "bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30" : "bg-[var(--color-accent)]/8"}`}>
        <p className="font-semibold text-[var(--color-navy)]">AI Findings</p>
        {v.ai_reading !== null && <p className="mt-0.5">Detected reading: <strong>{v.ai_reading} mL</strong></p>}
        <p className="mt-0.5 text-[var(--color-muted)]">{v.ai_message}</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full" style={{ width: `${confidencePct}%`, backgroundColor: isLow ? "var(--color-warning)" : "var(--color-accent)" }} />
          </div>
          <span className={`text-xs font-bold ${isLow ? "text-[var(--color-warning)]" : "text-[var(--color-accent)]"}`}>{confidencePct}%</span>
        </div>
        {isLow && <p className="mt-1 text-xs font-semibold text-[var(--color-warning)]">Low confidence — instructor review required</p>}
      </div>

      {/* Student photo */}
      {v.image_base64 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.image_base64.startsWith("data:") ? v.image_base64 : `data:image/jpeg;base64,${v.image_base64}`}
          alt={`Step ${v.step_number} capture`}
          className="max-h-64 w-full rounded-xl object-contain bg-black/5"
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-black/15 bg-[var(--color-surface)] text-[var(--color-muted)]">
          <div className="text-center text-sm">
            <p className="text-2xl">📷</p>
            <p>No image captured</p>
            <p className="text-xs">(manual override — step {v.step_number})</p>
          </div>
        </div>
      )}

      {/* Comment box */}
      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment for the student…"
          className="w-full rounded-xl border border-black/15 p-3 text-sm outline-none focus:border-[var(--color-brand)]"
          rows={2}
        />
      )}

      <div className="flex gap-2">
        <button onClick={() => onResolve("approved", comment)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent)] py-2.5 font-semibold text-white">
          <CheckCircle2 size={16} /> Approve
        </button>
        <button onClick={() => onResolve("rejected", comment)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-danger)] py-2.5 font-semibold text-white">
          <XCircle size={16} /> Reject
        </button>
        <button onClick={() => setShowComment((s) => !s)} className="flex items-center gap-1 rounded-xl border border-black/12 px-3 text-sm font-semibold text-[var(--color-navy)]">
          <MessageSquare size={15} />
        </button>
      </div>
    </div>
  );
}
