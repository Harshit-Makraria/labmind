"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Clock, FlaskConical, Layers, Lightbulb, Loader2, ShieldAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { loadSession } from "@/hooks/useSession";
import type { ClientSession } from "@/hooks/useSession";

export default function OverviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<ClientSession | null>(null);
  const [hypothesis, setHypothesis] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSession(loadSession(sessionId)); }, [sessionId]);

  if (!session) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="animate-spin text-[var(--color-brand)]" />
      </div>
    );
  }

  const p = session.protocol;
  const allReagents = [...new Set(p.steps.flatMap((s) => s.reagents.map((r) => r.name)))];
  const safetyFlags = [...new Set(p.steps.flatMap((s) => s.safety_flags).filter(Boolean))];
  const hasVision = p.steps.some((s) => s.vision_check_required);

  async function startExperiment() {
    if (hypothesis.trim()) {
      setSaving(true);
      await fetch(`/api/lab/${sessionId}/hypothesis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesis: hypothesis.trim() }),
      }).catch(() => {});
      setSaving(false);
    }
    router.push(`/lab/${sessionId}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2">
      {/* Header */}
      <div className="hero-gradient rounded-[var(--radius-card)] p-7 text-white">
        <span className="chip bg-white/15 text-white">
          <FlaskConical size={13} /> {p.steps.length} steps
        </span>
        <h1 className="mt-3 text-3xl font-extrabold">{p.experiment_name}</h1>
        <p className="mt-2 text-white/70">
          Objective: To {p.experiment_name.toLowerCase().includes("titration")
            ? "determine the concentration of an unknown acid by titration against a standard alkali"
            : p.experiment_name.toLowerCase().includes("gel")
            ? "estimate the size of an unknown DNA fragment using gel electrophoresis"
            : "measure the rate of a clock reaction and relate it to reactant concentrations"}.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-white/70">
          <span className="flex items-center gap-1"><Clock size={14} /> ~{p.steps.length * 5} min</span>
          <span className="flex items-center gap-1"><Layers size={14} /> {p.steps.length} steps</span>
          {hasVision && <span className="flex items-center gap-1"><Zap size={14} /> AI verification required</span>}
        </div>
      </div>

      {/* Hypothesis */}
      <div className="card p-5">
        <h3 className="mb-1 flex items-center gap-2 font-bold text-[var(--color-navy)]">
          <Lightbulb size={18} className="text-[var(--color-warning)]" /> Your prediction
        </h3>
        <p className="mb-3 text-sm text-[var(--color-muted)]">What result do you expect? Write your hypothesis before starting — LabMind will compare it to your actual result.</p>
        <textarea
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder={`e.g. "I predict the concentration of HCl is approximately 0.1 mol/L because…"`}
          rows={3}
          className="w-full resize-none rounded-xl border border-black/15 px-4 py-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        {hypothesis.trim() && (
          <p className="mt-1 text-xs text-[var(--color-accent)]">✓ Your prediction will be saved and reviewed at the end</p>
        )}
      </div>

      {/* Materials */}
      <div className="card p-5">
        <h3 className="mb-3 font-bold text-[var(--color-navy)]">Materials & apparatus</h3>
        <div className="flex flex-wrap gap-2">
          {allReagents.map((r) => (
            <span key={r} className="chip bg-[var(--color-brand)]/8 text-[var(--color-brand)]">{r}</span>
          ))}
          {allReagents.length === 0 && <p className="text-sm text-[var(--color-muted)]">See your experiment sheet</p>}
        </div>
      </div>

      {/* Safety */}
      {safetyFlags.length > 0 && (
        <div className="card border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-bold text-[var(--color-navy)]">
            <ShieldAlert size={18} className="text-[var(--color-warning)]" /> Safety guidelines
          </h3>
          <ul className="space-y-1.5">
            {safetyFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 text-[var(--color-warning)]">⚠</span> {f}
              </li>
            ))}
            <li className="flex items-start gap-2 text-sm"><span className="mt-0.5 shrink-0 text-[var(--color-warning)]">⚠</span> Wear goggles, lab coat, and gloves at all times</li>
            <li className="flex items-start gap-2 text-sm"><span className="mt-0.5 shrink-0 text-[var(--color-warning)]">⚠</span> Do not mix reagents unless instructed</li>
          </ul>
        </div>
      )}

      {/* Pre-lab quiz prompt */}
      <div className="card border-[var(--color-brand)]/20 bg-[var(--color-brand)]/5 p-5">
        <div className="flex items-start gap-3">
          <BookOpen size={20} className="mt-0.5 shrink-0 text-[var(--color-brand)]" />
          <div>
            <p className="font-semibold text-[var(--color-navy)]">Pre-lab quiz available</p>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">Test your understanding of this experiment before starting. Takes ~2 minutes.</p>
            <button
              onClick={() => router.push(`/lab/${sessionId}/prelab`)}
              className="mt-2 text-sm font-semibold text-[var(--color-brand)] hover:underline"
            >
              Take the pre-lab quiz →
            </button>
          </div>
        </div>
      </div>

      {/* Step overview */}
      <div className="card p-5">
        <h3 className="mb-3 font-bold text-[var(--color-navy)]">Procedure overview</h3>
        <ol className="space-y-2">
          {p.steps.map((s) => (
            <li key={s.step_number} className="flex items-start gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)]/10 text-xs font-bold text-[var(--color-brand)]">{s.step_number}</span>
              <div>
                <span className="font-semibold text-[var(--color-navy)]">{s.title}</span>
                {s.vision_check_required && <span className="ml-2 chip bg-[var(--color-accent)]/12 text-[var(--color-accent)]">📷 verify</span>}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <button
        onClick={startExperiment}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] py-4 text-lg font-bold text-white shadow-lg hover:brightness-110 disabled:opacity-60"
      >
        {saving ? <Loader2 size={22} className="animate-spin" /> : <FlaskConical size={22} />}
        {saving ? "Saving…" : "Start Experiment"}
      </button>
    </div>
  );
}
