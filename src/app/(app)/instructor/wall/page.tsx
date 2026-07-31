"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Radio } from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/ui/data-states";
import { fetchJson, isForbidden } from "@/lib/api-client";
import type { InstructorSession, RiskAssessment } from "@/lib/types";

/**
 * Bench wall display — designed to be projected and read from across a lab.
 * Deliberately low-density and high-contrast: an instructor should be able to
 * scan the room's state in one glance, not read it.
 */

const TONE: Record<RiskAssessment["band"], string> = {
  high:     "var(--color-danger)",
  elevated: "var(--color-warning)",
  moderate: "var(--color-brand)",
  low:      "var(--color-accent)",
};

/** Ring progress via conic-gradient — reads as a status dial, not a bar buried in a card. */
function ProgressRing({ pct, tone }: { pct: number; tone: string }) {
  const turn = Math.max(0.02, Math.min(1, pct / 100));
  return (
    <span
      className="ring-progress block h-11 w-11 shrink-0"
      style={{
        background: `conic-gradient(${tone} 0turn ${turn}turn, rgba(15,41,66,.1) ${turn}turn 1turn)`,
      }}
      aria-hidden
    >
      <span className="grid h-full w-full place-items-center rounded-full bg-[var(--color-card)]">
        <span className="font-data text-[11px] font-semibold" style={{ color: tone }}>{pct}%</span>
      </span>
    </span>
  );
}

export default function WallPage() {
  const [code, setCode] = useState("");

  const { data: sessions = [] } = useQuery<InstructorSession[]>({
    queryKey: ["instructor-sessions"],
    queryFn: () => fetchJson<InstructorSession[]>("/api/instructor/sessions"),
  });

  const active = code || sessions[0]?.code || "";

  const { data: students = [], isLoading, isError, isPaused, error, failureReason, refetch, dataUpdatedAt } = useQuery<RiskAssessment[]>({
    queryKey: ["risk", active],
    queryFn: () => fetchJson<RiskAssessment[]>(`/api/instructor/sessions/${active}/risk`),
    enabled: !!active,
    refetchInterval: 4000,
  });

  const alerts = students.filter((s) => s.band === "high" || s.band === "elevated").length;

  if (isError || isPaused) {
    const forbidden = isForbidden(error) || isForbidden(failureReason);
    return <ErrorState title="Couldn't load the bench" onRetry={() => refetch()} offline={!forbidden && isPaused} forbidden={forbidden} />;
  }

  return (
    <div className="space-y-4">
      <div className="anim-fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Bench view</h2>
          <p className="flex items-center gap-1.5 text-sm text-[var(--color-muted)]">
            <span className="live-dot text-[var(--color-accent)]" aria-hidden />
            Every student at a glance · updates every 4s
            {dataUpdatedAt ? ` · last ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alerts > 0 && (
            <span className="alert-ring flex items-center gap-1.5 rounded-full bg-[var(--color-danger)] px-3 py-1 text-sm font-bold text-white">
              <Radio size={13} /> {alerts} need attention
            </span>
          )}
          {sessions.length > 0 && (
            <select value={active} onChange={(e) => setCode(e.target.value)} className="input-base min-w-[180px]">
              {sessions.map((s) => (
                <option key={s.code} value={s.code}>{s.code} — {s.session_name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="animate-spin text-[var(--color-brand)]" />
        </div>
      )}

      {!isLoading && students.length === 0 && (
        <div className="card anim-fade-up py-16 text-center">
          <p className="font-semibold text-[var(--color-navy)]">No students in this session yet</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {active ? `Share code ${active} with your class.` : "Create a session to begin."}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {students.map((s, i) => {
          const tone = TONE[s.band];
          const pct = s.total_steps ? Math.round((s.current_step / s.total_steps) * 100) : 0;
          const urgent = s.band === "high";
          return (
            <div
              key={s.session_id}
              className={`card card-hover anim-fade-up relative overflow-hidden p-4 ${urgent ? "alert-ring" : ""}`}
              style={{
                animationDelay: `${Math.min(i, 8) * 0.05}s`,
                boxShadow: urgent ? `0 0 0 2px ${tone}` : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <ProgressRing pct={pct} tone={tone} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-[var(--color-navy)]">{s.student_name}</p>
                  <p className="font-data text-xs text-[var(--color-muted)]">
                    Step {s.current_step} / {s.total_steps}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: tone }}
                >
                  {s.band === "low" ? "On track" : s.band}
                </span>
                {s.pacing_verdict === "implausible" && (
                  <span className="text-xs font-bold text-[var(--color-danger)]">⏱ pacing</span>
                )}
              </div>

              {s.factors.length > 0 && s.factors[0].weight > 0 && (
                <p className="mt-2 truncate text-xs text-[var(--color-muted)]">{s.factors[0].label}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
