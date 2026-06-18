"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Filter } from "lucide-react";
import { useState } from "react";
import type { SessionSummary } from "@/lib/types";

export default function ReportsPage() {
  const { data: sessions } = useQuery<SessionSummary[]>({
    queryKey: ["sessions"],
    queryFn: async () => (await fetch("/api/dashboard/sessions", { cache: "no-store" })).json(),
  });
  const [filter, setFilter] = useState({ student: "", experiment: "" });

  const list = (sessions ?? []).filter((s) =>
    (filter.student === "" || s.student_name.toLowerCase().includes(filter.student.toLowerCase())) &&
    (filter.experiment === "" || s.experiment_name.toLowerCase().includes(filter.experiment.toLowerCase()))
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[var(--color-navy)]">Reports Dashboard</h2>
        <p className="text-sm text-[var(--color-muted)]">View and download auto-generated lab reports</p>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <Filter size={16} className="text-[var(--color-muted)]" />
        <input
          value={filter.student}
          onChange={(e) => setFilter({ ...filter, student: e.target.value })}
          placeholder="Filter by student"
          className="min-h-[38px] flex-1 rounded-lg border border-black/12 px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <input
          value={filter.experiment}
          onChange={(e) => setFilter({ ...filter, experiment: e.target.value })}
          placeholder="Filter by experiment"
          className="min-h-[38px] flex-1 rounded-lg border border-black/12 px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.length === 0 && (
          <div className="card col-span-full py-12 text-center text-[var(--color-muted)]">
            <FileText className="mx-auto mb-2" size={32} />
            <p>No reports match your filters.</p>
          </div>
        )}
        {list.map((s) => (
          <div key={s.session_id} className="card space-y-3 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-[var(--color-navy)]">{s.student_name}</p>
                <p className="text-sm text-[var(--color-muted)]">{s.experiment_name}</p>
                <p className="text-xs text-[var(--color-muted)]">{new Date(s.updated_at).toLocaleDateString()}</p>
              </div>
              <span className={`chip text-white ${s.status === "completed" ? "bg-[var(--color-accent)]" : "bg-[var(--color-brand)]"}`}>
                {s.status}
              </span>
            </div>

            {s.deviation_percent !== null && (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/8">
                  <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(0, 100 - s.deviation_percent * 5)}%` }} />
                </div>
                <span className="text-xs font-bold text-[var(--color-navy)]">{Math.round(Math.max(0, 100 - s.deviation_percent * 5))}%</span>
              </div>
            )}

            {s.safety_alert_count > 0 && (
              <p className="text-xs text-[var(--color-warning)]">⚠️ {s.safety_alert_count} safety alert(s)</p>
            )}

            <a
              href={`/lab/${s.session_id}/report`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-2 text-sm font-semibold text-white hover:bg-[var(--color-navy-700)]"
            >
              <Download size={15} /> View report
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
