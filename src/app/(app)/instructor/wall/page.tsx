"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Radio } from "lucide-react";
import { useState } from "react";
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

export default function WallPage() {
  const [code, setCode] = useState("");

  const { data: sessions = [] } = useQuery<InstructorSession[]>({
    queryKey: ["instructor-sessions"],
    queryFn: async () => (await fetch("/api/instructor/sessions", { cache: "no-store" })).json(),
  });

  const active = code || sessions[0]?.code || "";

  const { data: students = [], isLoading, dataUpdatedAt } = useQuery<RiskAssessment[]>({
    queryKey: ["risk", active],
    queryFn: async () => (await fetch(`/api/instructor/sessions/${active}/risk`, { cache: "no-store" })).json(),
    enabled: !!active,
    refetchInterval: 4000,
  });

  const alerts = students.filter((s) => s.band === "high" || s.band === "elevated").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Bench view</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Every student at a glance · updates every 4s
            {dataUpdatedAt ? ` · last ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alerts > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-danger)] px-3 py-1 text-sm font-bold text-white">
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
        <div className="card py-16 text-center">
          <p className="font-semibold text-[var(--color-navy)]">No students in this session yet</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {active ? `Share code ${active} with your class.` : "Create a session to begin."}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {students.map((s) => {
          const tone = TONE[s.band];
          const pct = s.total_steps ? Math.round((s.current_step / s.total_steps) * 100) : 0;
          const urgent = s.band === "high";
          return (
            <div
              key={s.session_id}
              className="card relative overflow-hidden p-4"
              style={urgent ? { boxShadow: `0 0 0 2px ${tone}` } : undefined}
            >
              {urgent && (
                <span
                  className="absolute right-3 top-3 h-2.5 w-2.5 animate-pulse rounded-full"
                  style={{ backgroundColor: tone }}
                  aria-hidden
                />
              )}

              <p className="truncate pr-5 text-lg font-bold text-[var(--color-navy)]">{s.student_name}</p>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                Step {s.current_step} / {s.total_steps}
              </p>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.07]">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: tone }} />
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
