"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, Lock, ShieldAlert, Timer, TriangleAlert } from "lucide-react";
import { use } from "react";
import { ErrorState } from "@/components/ui/data-states";
import { fetchJson, isForbidden } from "@/lib/api-client";
import type { ChainVerification, ChainedEvent, PacingReport } from "@/lib/types";

const VERDICT: Record<PacingReport["verdict"], { color: string; label: string }> = {
  no_data:            { color: "var(--color-muted)",   label: "Not enough data yet" },
  consistent:         { color: "var(--color-accent)",  label: "Consistent with genuine lab work" },
  review_recommended: { color: "var(--color-warning)", label: "Review recommended" },
  implausible:        { color: "var(--color-danger)",  label: "Implausible timing" },
};

function fmt(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export default function IntegrityPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);

  const { data: pacing, isLoading, isError, isPaused, error, failureReason, refetch } = useQuery<PacingReport>({
    queryKey: ["pacing", sessionId],
    queryFn: () => fetchJson<PacingReport>(`/api/lab/${sessionId}/pacing`),
  });

  const { data: audit } = useQuery<{ chain: ChainedEvent[]; verification: ChainVerification; student_name: string }>({
    queryKey: ["audit", sessionId],
    queryFn: () => fetchJson(`/api/lab/${sessionId}/audit`),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-[var(--color-brand)]" />
      </div>
    );
  }

  if (isError || isPaused) {
    const forbidden = isForbidden(error) || isForbidden(failureReason);
    return <ErrorState title="Couldn't load timing integrity" onRetry={() => refetch()} offline={!forbidden && isPaused} forbidden={forbidden} />;
  }

  if (!pacing || !Array.isArray(pacing.steps)) {
    return <p className="card p-6 text-sm text-[var(--color-muted)]">No timing data recorded for this session yet.</p>;
  }

  const v = VERDICT[pacing.verdict];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Integrity headline */}
      <div className="card anim-fade-up space-y-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
              <Timer size={15} /> Timing integrity
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              How long each step actually took, against the protocol&apos;s own stated durations.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-data text-3xl font-bold leading-none" style={{ color: v.color }}>
              {pacing.integrity_score ?? "—"}
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {pacing.integrity_score === null ? "not yet scored" : "out of 100"}
            </p>
          </div>
        </div>

        <p className="anim-scale-in rounded-[var(--radius-btn)] px-3 py-2 text-sm font-semibold"
           style={{ backgroundColor: `color-mix(in srgb, ${v.color} 12%, transparent)`, color: v.color }}>
          {v.label}
        </p>
        <p className="text-sm text-[var(--color-navy)]">{pacing.summary}</p>

        <div className="font-data flex gap-4 text-xs text-[var(--color-muted)]">
          <span>Total elapsed: <strong className="text-[var(--color-navy)]">{fmt(pacing.total_seconds)}</strong></span>
          <span>Protocol estimate: <strong className="text-[var(--color-navy)]">{fmt(pacing.expected_total_seconds)}</strong></span>
        </div>
      </div>

      {/* Step timeline */}
      <div className="card anim-fade-up stagger-1 p-5">
        <p className="mb-3 text-sm font-bold text-[var(--color-navy)]">Step timeline</p>
        <ol className="space-y-0">
          {pacing.steps.map((s, i) => {
            const flagged = !!s.flag;
            const dot = flagged ? "var(--color-danger)" : "var(--color-accent)";
            const last = i === pacing.steps.length - 1;
            return (
              <li
                key={s.step_number}
                className="anim-fade-up relative flex gap-3 pb-4"
                style={{ animationDelay: `${0.1 + i * 0.06}s` }}
              >
                {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-black/10" aria-hidden />}
                <span
                  className="relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-[var(--color-card)] transition-transform"
                  style={{ backgroundColor: dot, boxShadow: flagged ? `0 0 0 3px color-mix(in srgb, ${dot} 25%, transparent)` : undefined }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-semibold text-[var(--color-navy)]">
                      {s.step_number}. {s.title}
                    </p>
                    <p className="font-data text-xs" style={{ color: flagged ? "var(--color-danger)" : "var(--color-muted)" }}>
                      {fmt(s.elapsed_seconds)}
                      {s.expected_seconds !== null && (
                        <span className="text-[var(--color-muted)]"> / {fmt(s.expected_seconds)} expected</span>
                      )}
                    </p>
                  </div>
                  {s.reason && (
                    <p className="mt-1 flex items-start gap-1.5 rounded-md bg-[var(--color-danger)]/8 px-2 py-1.5 text-xs text-[var(--color-danger)]">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                      <span>{s.reason}</span>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {pacing.steps.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--color-muted)]">No steps completed yet.</p>
        )}
      </div>

      {/* Tamper-evident safety record */}
      {audit && (
        <div className="card anim-fade-up stagger-2 space-y-3 p-5">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-navy)]">
              <Lock size={15} /> Safety record
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Each entry is signed with the hash of the one before it. Altering or removing any
              past event breaks the chain and is detectable.
            </p>
          </div>

          <p
            className="anim-scale-in flex items-center gap-2 rounded-[var(--radius-btn)] px-3 py-2 text-sm font-semibold"
            style={{
              backgroundColor: audit.verification.intact
                ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                : "color-mix(in srgb, var(--color-danger) 12%, transparent)",
              color: audit.verification.intact ? "var(--color-accent)" : "var(--color-danger)",
            }}
          >
            {audit.verification.intact ? <CheckCircle2 size={15} /> : <ShieldAlert size={15} />}
            {audit.verification.message}
          </p>

          {audit.chain.length > 0 && (
            <ul className="space-y-2">
              {audit.chain.map((e, i) => (
                <li
                  key={e.hash}
                  className="anim-fade-up rounded-[var(--radius-btn)] border border-black/[0.08] p-3 transition-colors hover:border-[var(--color-brand)]/25"
                  style={{ animationDelay: `${0.1 + i * 0.06}s` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--color-navy)]">
                      Step {e.step_number} · {e.summary}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white"
                          style={{ backgroundColor: e.severity === "high" ? "var(--color-danger)" : e.severity === "medium" ? "var(--color-warning)" : "var(--color-brand)" }}>
                      {e.severity}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                    <Clock size={11} /> {new Date(e.at).toLocaleString()}
                  </p>
                  <p className="font-data mt-1 truncate text-[10px] text-[var(--color-muted)]">
                    {e.hash.slice(0, 12)}… ← {e.prev_hash.slice(0, 12)}…
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
