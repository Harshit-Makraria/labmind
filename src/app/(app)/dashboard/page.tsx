"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Lock,
  PencilLine,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { SessionSummary } from "@/lib/types";

const UNLOCK_KEY = "labmind:instructor";
const statusColor: Record<string, string> = {
  active: "var(--color-brand)",
  completed: "var(--color-accent)",
  safety_alert: "var(--color-danger)",
};

export default function DashboardPage() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true);
  }, []);
  if (!unlocked) return <PasscodeGate onUnlock={() => setUnlocked(true)} />;
  return <Console />;
}

function PasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState("");
  const verify = useMutation({
    mutationFn: () => api.verifyPasscode(passcode),
    onSuccess: (res) => {
      if (res.ok) {
        sessionStorage.setItem(UNLOCK_KEY, "1");
        onUnlock();
      } else toast.error("Incorrect passcode");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center">
      <div className="card space-y-4 p-6">
        <div className="flex items-center gap-2 text-[var(--color-navy)]">
          <Lock size={20} />
          <h1 className="text-xl font-bold">Instructor access</h1>
        </div>
        <p className="text-sm text-[var(--color-muted)]">Enter the instructor passcode to view the live cohort.</p>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verify.mutate()}
          placeholder="Passcode"
          className="min-h-[52px] w-full rounded-[var(--radius-btn)] border border-black/15 px-4 outline-none focus:border-[var(--color-brand)]"
        />
        <Button onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? "Checking…" : "Unlock console"}
        </Button>
        <p className="text-center text-xs text-[var(--color-muted)]/70">Demo passcode: labmind2026</p>
      </div>
    </div>
  );
}

function Console() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: api.dashboardSessions, refetchInterval: 4000 });
  const list = sessions ?? [];

  const completed = list.filter((s) => s.status === "completed").length;
  const alerts = list.reduce((n, s) => n + s.safety_alert_count, 0);
  const active = list.filter((s) => s.status === "active").length;

  function exportCsv() {
    const header = ["Student", "Experiment", "Step", "Status", "Deviation%", "SafetyAlerts", "FlaggedSteps", "Overrides"];
    const rows = list.map((s) => [
      s.student_name,
      s.experiment_name,
      `${s.current_step}/${s.total_steps}`,
      s.status,
      s.deviation_percent ?? "",
      s.safety_alert_count,
      s.flagged_step_count,
      s.override_count,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "labmind-cohort.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-navy)]">Instructor Console</h2>
          <p className="text-sm text-[var(--color-muted)]">Live class monitoring · refreshes every 4s</p>
        </div>
        <Button variant="outline" fullWidth={false} size="sm" onClick={exportCsv}>
          <Download size={15} /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Students" value={list.length} />
        <Stat label="Active" value={active} color="var(--color-brand)" />
        <Stat label="Completed" value={completed} color="var(--color-accent)" />
        <Stat label="Safety alerts" value={alerts} color={alerts ? "var(--color-danger)" : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-muted)]">Cohort</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((s) => (
              <SessionRow key={s.session_id} s={s} onClick={() => setSelected(s.session_id)} />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <AgentConsole />
          <TracePanel />
        </div>
      </div>

      {selected && <DetailDrawer sessionId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-extrabold" style={{ color: color ?? "var(--color-navy)" }}>
        {value}
      </p>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function SessionRow({ s, onClick }: { s: SessionSummary; onClick: () => void }) {
  const pct = Math.round((s.current_step / s.total_steps) * 100);
  return (
    <button onClick={onClick} className="card space-y-2 p-4 text-left transition hover:shadow-[var(--shadow-pop)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-[var(--color-navy)]">{s.student_name}</p>
          <p className="text-xs text-[var(--color-muted)]">
            Step {s.current_step}/{s.total_steps} · {s.experiment_name}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white ${s.status === "safety_alert" ? "pulse-dot" : ""}`}
          style={{ backgroundColor: statusColor[s.status] ?? "var(--color-navy)" }}
        >
          {s.status.replace("_", " ")}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: statusColor[s.status] }} />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--color-muted)]">
        {s.last_vision_pass !== null && (
          <span className="flex items-center gap-1">
            {s.last_vision_pass ? (
              <CheckCircle2 size={12} className="text-[var(--color-accent)]" />
            ) : (
              <AlertTriangle size={12} className="text-[var(--color-warning)]" />
            )}
            vision
          </span>
        )}
        {s.deviation_percent !== null && <span>Δ {s.deviation_percent}%</span>}
        {s.flagged_step_count > 0 && <span className="text-[var(--color-warning)]">{s.flagged_step_count} flagged</span>}
        {s.override_count > 0 && <span>{s.override_count} override</span>}
        {s.safety_alert_count > 0 && (
          <span className="flex items-center gap-1 text-[var(--color-danger)]">
            <AlertTriangle size={12} /> {s.safety_alert_count}
          </span>
        )}
      </div>
    </button>
  );
}

function AgentConsole() {
  const { data } = useQuery({ queryKey: ["decisions"], queryFn: api.dashboardDecisions, refetchInterval: 3000 });
  const decisions = data ?? [];
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/8 px-4 py-3">
        <Cpu size={16} className="text-[var(--color-brand)]" />
        <h3 className="font-bold text-[var(--color-navy)]">Agent Console</h3>
        <span className="chip bg-[var(--color-accent)]/12 text-[var(--color-accent)]">{decisions.length} decisions</span>
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto p-3">
        {decisions.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-[var(--color-muted)]">
            No agent activity yet. Trigger a safety alert or chat with the assistant to see live decisions.
          </p>
        )}
        {decisions.map((d) => (
          <div key={d.id} className="rounded-lg border border-black/8 bg-black/[0.02] p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--color-navy)]">{d.trigger.slice(0, 60)}</span>
              <span className="text-[var(--color-muted)]">{d.latency_ms}ms · {d.provider}</span>
            </div>
            <p className="mt-1 italic text-[var(--color-muted)]">{d.plan}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {d.tools.map((t, i) => (
                <span key={i} className="chip bg-[var(--color-brand)]/10 font-mono text-[var(--color-brand)]">
                  {t.tool}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[var(--color-ink)]/80">→ {d.outcome}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TracePanel() {
  const { data } = useQuery({ queryKey: ["traces"], queryFn: api.dashboardTraces, refetchInterval: 4000 });
  const traces = data ?? [];
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/8 px-4 py-3">
        <Activity size={16} className="text-[var(--color-accent)]" />
        <h3 className="font-bold text-[var(--color-navy)]">Tool traces</h3>
      </div>
      <div className="max-h-60 space-y-1.5 overflow-y-auto p-3">
        {traces.length === 0 && <p className="px-1 py-3 text-center text-xs text-[var(--color-muted)]">No tool calls yet.</p>}
        {traces.map((t, i) => (
          <div key={i} className="rounded-md border border-black/8 bg-white px-2.5 py-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-[var(--color-brand)]">{t.tool_name}</span>
              <span className="text-[var(--color-muted)]">
                {t.latency_ms}ms{t.confidence != null ? ` · ${(t.confidence * 100).toFixed(0)}%` : ""}
              </span>
            </div>
            <p className="mt-0.5 text-[var(--color-muted)]">{t.input_summary} → {t.output_summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["detail", sessionId],
    queryFn: () => api.sessionDetail(sessionId),
    refetchInterval: 4000,
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col bg-[var(--color-card)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/8 px-4 py-3">
          <div>
            <h3 className="font-bold text-[var(--color-navy)]">{data?.student_name ?? "Session"}</h3>
            <p className="text-xs text-[var(--color-muted)]">{data?.experiment_name}</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-navy)]">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!data && <p className="text-sm text-[var(--color-muted)]">No detail for this session yet (it may be seed data).</p>}

          {data && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="navy">Step {data.current_step}/{data.total_steps}</Badge>
                <Badge tone={data.status === "completed" ? "accent" : data.status === "safety_alert" ? "danger" : "brand"}>
                  {data.status.replace("_", " ")}
                </Badge>
                {data.deviation_percent !== null && <Badge tone="muted">Δ {data.deviation_percent}%</Badge>}
              </div>

              <section>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">Step history</h4>
                <div className="space-y-1.5">
                  {data.steps.map((st) => (
                    <div key={st.step_number} className="flex items-center gap-2 rounded-md border border-black/8 px-2.5 py-1.5 text-xs">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/5 font-bold">{st.step_number}</span>
                      <span className="font-semibold capitalize text-[var(--color-navy)]">{st.state}</span>
                      {st.flagged && <span className="text-[var(--color-warning)]">flagged</span>}
                      {st.vision_reading !== null && <span className="text-[var(--color-muted)]">read {st.vision_reading}</span>}
                      {st.manual_override && (
                        <span className="flex items-center gap-1 text-[var(--color-brand)]">
                          <PencilLine size={11} /> override {st.manual_override.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {data.safety_log.length > 0 && (
                <section>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">Safety log</h4>
                  <div className="space-y-1.5">
                    {data.safety_log.map((e, i) => (
                      <div key={i} className="rounded-md bg-[var(--color-danger)]/8 px-2.5 py-1.5 text-xs text-[var(--color-navy)]">
                        Step {e.step_number}: {e.alerts.map((a) => `${a.type} (${a.severity})`).join(", ")}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.notes.length > 0 && (
                <section>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">Notes to instructor</h4>
                  <div className="space-y-1.5">
                    {data.notes.map((n, i) => (
                      <p key={i} className="rounded-md bg-black/[0.03] px-2.5 py-1.5 text-xs text-[var(--color-ink)]/80">{n}</p>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
