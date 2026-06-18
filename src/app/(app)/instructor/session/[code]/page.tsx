"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";
import { use } from "react";
import type { SessionSummary } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  active: "bg-[var(--color-brand)] text-white",
  completed: "bg-[var(--color-accent)] text-white",
  safety_alert: "bg-[var(--color-danger)] text-white",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Running",
  completed: "Completed",
  safety_alert: "Safety Alert",
};

export default function SessionMonitorPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);

  const { data: students, dataUpdatedAt } = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: async () => (await fetch("/api/dashboard/sessions", { cache: "no-store" })).json(),
    refetchInterval: 3000,
  });

  const list = students ?? [];
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-navy)]">Session monitor</h2>
          <p className="text-sm text-[var(--color-muted)]">Code: <span className="font-mono font-bold text-[var(--color-brand)]">{code}</span> · Updates every 3 s</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          <RefreshCw size={13} className="animate-spin" /> Last: {lastUpdate}
        </div>
      </div>

      {/* Student table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-black/8 bg-[var(--color-surface)]">
            <tr>
              {["Student", "Experiment", "Current step", "Progress", "Status", "Alerts"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[var(--color-muted)]">
                  <Loader2 className="mx-auto mb-2 animate-spin" />
                  Waiting for students to join…
                </td>
              </tr>
            )}
            {list.map((s) => {
              const pct = Math.round((s.current_step / s.total_steps) * 100);
              return (
                <tr key={s.session_id} className="border-b border-black/5 hover:bg-[var(--color-surface)]/50">
                  <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{s.student_name}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{s.experiment_name}</td>
                  <td className="px-4 py-3">{s.current_step} / {s.total_steps}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-black/8">
                        <div className="h-full rounded-full bg-[var(--color-brand)] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[var(--color-navy)]">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`chip ${STATUS_COLOR[s.status] ?? "bg-black/10 text-[var(--color-navy)]"}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.safety_alert_count > 0 && (
                      <span className="flex items-center gap-1 text-[var(--color-danger)]">
                        <AlertTriangle size={14} /> {s.safety_alert_count}
                      </span>
                    )}
                    {s.last_vision_pass === false && (
                      <span className="flex items-center gap-1 text-[var(--color-warning)]">
                        <Clock size={14} /> vision pending
                      </span>
                    )}
                    {s.status === "completed" && <CheckCircle2 size={16} className="text-[var(--color-accent)]" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SCard label="Total students" value={list.length} />
        <SCard label="Running" value={list.filter((s) => s.status === "active").length} />
        <SCard label="Completed" value={list.filter((s) => s.status === "completed").length} color="accent" />
        <SCard label="Safety alerts" value={list.reduce((n, s) => n + s.safety_alert_count, 0)} color="danger" />
      </div>
    </div>
  );
}

function SCard({ label, value, color = "navy" }: { label: string; value: number; color?: string }) {
  const c: Record<string, string> = { navy: "text-[var(--color-navy)]", accent: "text-[var(--color-accent)]", danger: "text-[var(--color-danger)]" };
  return (
    <div className="card p-4 text-center">
      <p className={`text-2xl font-extrabold ${c[color]}`}>{value}</p>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}
