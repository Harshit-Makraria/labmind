"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Flag, Target, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/data-states";
import { VISION_HIGH_CONFIDENCE } from "@/lib/types";
import type { AccuracyReport, VerificationEntry } from "@/lib/types";

export default function VerifyPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isError, isPaused, refetch } = useQuery<VerificationEntry[]>({
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
    mutationFn: async (vars: { id: string; status: "approved" | "rejected"; comment?: string; correctedReading?: number | null }) => {
      const res = await fetch("/api/instructor/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", id: vars.id, status: vars.status, comment: vars.comment, corrected_reading: vars.correctedReading }),
      });
      if (!res.ok) throw new Error("Failed to save decision");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["verifications"] }); toast.success("Decision saved"); setSelectedId(null); },
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
  const selected = pending.find((v) => v.id === selectedId) ?? pending[0] ?? null;

  // Keep a selection pinned to whatever's actually left in the queue.
  useEffect(() => {
    if (!selectedId && pending[0]) setSelectedId(pending[0].id);
    if (selectedId && !pending.some((v) => v.id === selectedId)) setSelectedId(pending[0]?.id ?? null);
  }, [pending, selectedId]);

  const oldestMinutes = pending.length
    ? Math.max(0, Math.round((Date.now() - new Date(pending[pending.length - 1].submitted_at).getTime()) / 60000))
    : 0;

  if (isError || isPaused) {
    return <ErrorState title="Couldn't load the verification queue" onRetry={() => refetch()} offline={isPaused} />;
  }

  return (
    <div className="space-y-5">
      <div className="anim-fade-up flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Verification queue</h2>
          <p className="text-sm text-[var(--color-muted)]">The instructor overrules the AI here — your reading is recorded as authoritative.</p>
        </div>
        {pending.length > 0 && (
          <span className="font-data text-xs text-[var(--color-muted)]">
            {pending.length} waiting · oldest {oldestMinutes} min
          </span>
        )}
      </div>

      <AccuracyCard report={accuracy} />

      {pending.length === 0 ? (
        <div className="card anim-fade-up flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 size={40} className="text-[var(--color-accent)]" />
          <p className="font-semibold text-[var(--color-navy)]">Nothing waiting</p>
          <p className="text-sm text-[var(--color-muted)]">
            {accuracy && accuracy.resolved > 0
              ? `${Math.round((accuracy.agreement ?? 0) * 100)}% of checks agreed with your decisions so far.`
              : "New submissions will appear here automatically."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
          {/* Queue list */}
          <div className="space-y-2">
            {pending.map((v, i) => (
              <QueueRow key={v.id} v={v} active={v.id === selected?.id} onClick={() => setSelectedId(v.id)} index={i} />
            ))}
          </div>

          {/* Review detail */}
          {selected && (
            <ReviewDetail
              key={selected.id}
              v={selected}
              onResolve={(status, comment, correctedReading) => resolve.mutate({ id: selected.id, status, comment, correctedReading })}
              pending={resolve.isPending}
            />
          )}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-muted)]">Resolved</h3>
          <div className="space-y-2">
            {resolved.map((v, i) => (
              <div key={v.id} className="card card-hover anim-fade-up flex items-center justify-between p-4" style={{ animationDelay: `${Math.min(i, 6) * 0.04}s` }}>
                <div>
                  <p className="font-semibold text-[var(--color-navy)]">{v.student_name} — Step {v.step_number}</p>
                  <p className="font-data text-xs text-[var(--color-muted)]">{new Date(v.submitted_at).toLocaleString()}</p>
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
      <div className="card anim-fade-up flex items-center gap-3 p-4 text-sm text-[var(--color-muted)]">
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
    <div className="card anim-fade-up space-y-3 p-5">
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
          <p className="font-data text-2xl font-bold leading-none" style={{ color: tone }}>{agreementPct}%</p>
          <p className="font-data text-[11px] text-[var(--color-muted)]">{report.approved} approved · {report.rejected} rejected</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {report.byConfidence.map((b) => (
          <div key={b.label} className="rounded-lg bg-black/[0.03] px-3 py-2">
            <p className="text-[11px] font-semibold text-[var(--color-muted)]">{b.label}</p>
            <p className="font-data text-sm font-bold text-[var(--color-navy)]">
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

function QueueRow({ v, active, onClick, index }: { v: VerificationEntry; active: boolean; onClick: () => void; index: number }) {
  const confidencePct = Math.round(v.ai_confidence * 100);
  const isLow = v.ai_confidence < VISION_HIGH_CONFIDENCE;
  const isOverride = !v.image_base64;
  const minsAgo = Math.max(0, Math.round((Date.now() - new Date(v.submitted_at).getTime()) / 60000));

  return (
    <button
      onClick={onClick}
      className={`card anim-fade-up flex w-full gap-3 p-3.5 text-left transition-all ${active ? "shadow-[0_0_0_2px_var(--color-brand)]" : "hover:border-[var(--color-brand)]/30"}`}
      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
    >
      <div
        className="h-[58px] w-[46px] shrink-0 rounded-lg bg-cover bg-center"
        style={{
          background: v.image_base64
            ? `center / cover no-repeat url(${v.image_base64.startsWith("data:") ? v.image_base64 : `data:image/jpeg;base64,${v.image_base64}`})`
            : "linear-gradient(160deg,#3a4650,#20272e)",
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[var(--color-navy)]">{v.student_name}</p>
        <p className="truncate text-xs text-[var(--color-muted)]">
          Step {v.step_number} · {isOverride ? "manual override" : `${confidencePct}% confidence`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-bold">
          {isOverride ? (
            <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[var(--color-muted)]">OVERRIDE</span>
          ) : isLow ? (
            <span className="rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[#b8860b]">NEEDS REVIEW</span>
          ) : null}
          <span className="font-data rounded-full bg-black/[0.04] px-2 py-0.5 text-[var(--color-muted)]">{minsAgo}m</span>
        </div>
      </div>
    </button>
  );
}

function ReviewDetail({
  v,
  onResolve,
  pending,
}: {
  v: VerificationEntry;
  onResolve: (status: "approved" | "rejected", comment?: string, correctedReading?: number | null) => void;
  pending: boolean;
}) {
  const [reading, setReading] = useState(v.ai_reading !== null ? String(v.ai_reading) : "");
  const confidencePct = Math.round(v.ai_confidence * 100);
  const isLow = v.ai_confidence < VISION_HIGH_CONFIDENCE;
  const parsedReading = Number.parseFloat(reading);
  const hasCorrection = v.ai_reading !== null && !Number.isNaN(parsedReading) && parsedReading !== v.ai_reading;

  return (
    <div className="card anim-scale-in space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            Review · step {v.step_number}
          </p>
          <h3 className="text-xl font-extrabold text-[var(--color-navy)]">{v.student_name}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-warning)]/15 px-3 py-1.5 text-[11px] font-bold text-[#b8860b]">
          AWAITING YOU
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {v.image_base64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={v.image_base64.startsWith("data:") ? v.image_base64 : `data:image/jpeg;base64,${v.image_base64}`}
            alt={`Step ${v.step_number} capture`}
            className="anim-scale-in h-56 w-full rounded-[0.9rem] object-contain bg-black/5"
          />
        ) : (
          <div className="flex h-56 items-center justify-center rounded-[0.9rem] border-2 border-dashed border-black/15 bg-[var(--color-surface)] text-center text-sm text-[var(--color-muted)]">
            <div>
              <p className="text-2xl">📷</p>
              <p>Manual override — no photo</p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">LabMind read</p>
            <p className="font-data text-[1.75rem] font-bold leading-none text-[var(--color-navy)]">
              {v.ai_reading ?? "—"}
              {isLow && <span className="opacity-40">?</span>}
            </p>
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-[var(--color-muted)]">
              <span>Confidence</span>
              <span className="font-data" style={{ color: isLow ? "#b8860b" : "var(--color-accent)" }}>{confidencePct}%</span>
            </div>
            <div className="progress-track mt-1">
              <div className="progress-fill" style={{ width: `${confidencePct}%`, backgroundColor: isLow ? "var(--color-warning)" : "var(--color-accent)" }} />
              <span className="progress-marker" style={{ left: `${VISION_HIGH_CONFIDENCE * 100}%` }} />
            </div>
          </div>

          <div className="rounded-[var(--radius-btn)] bg-[var(--color-brand)]/8 p-3">
            <p className="text-xs font-semibold text-[var(--color-brand)]">Model reasoning</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-navy)]">{v.ai_message}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 rounded-[var(--radius-btn)] bg-black/[0.02] p-3">
        <span className="text-sm font-semibold text-[var(--color-muted)]">Your reading</span>
        <input
          type="number"
          step="any"
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          className="font-data w-28 min-h-[42px] rounded-[var(--radius-btn)] border-2 px-3 text-[15px] outline-none transition-colors"
          style={{ borderColor: hasCorrection ? "var(--color-brand)" : "rgba(15,41,66,.15)" }}
        />
        <span className="text-xs text-[var(--color-muted)]">
          {hasCorrection ? "differs from the AI — yours will be recorded as authoritative" : "mL"}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => onResolve("approved", undefined, Number.isNaN(parsedReading) ? null : parsedReading)}
          className="btn-secondary flex-1"
          style={{ background: "var(--color-accent)" }}
        >
          <CheckCircle2 size={16} /> {hasCorrection ? `Accept ${reading}` : "Accept"}
        </button>
        <button disabled={pending} onClick={() => onResolve("rejected", "Rejected — asked for retake")} className="btn-ghost flex-1">
          <XCircle size={16} /> Reject &amp; retake
        </button>
        <button
          disabled={pending}
          onClick={() => onResolve("rejected", "🚩 Flagged for follow-up")}
          className="btn-ghost px-4"
          style={{ borderColor: "rgba(229,62,62,.4)", color: "var(--color-danger)" }}
        >
          <Flag size={16} />
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
        Your decision is written to the safety log with the AI&apos;s original output beside it, so the disagreement stays visible in the record.
      </p>
    </div>
  );
}
