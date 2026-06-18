"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Lightbulb, Loader2, Star, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import type { LearningSummary } from "@/lib/types";

export default function SummaryPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);

  const { data } = useQuery<LearningSummary>({
    queryKey: ["summary", sessionId],
    queryFn: async () => (await fetch(`/api/lab/${sessionId}/summary`, { cache: "no-store" })).json(),
  });

  if (!data) return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Loader2 className="animate-spin text-[var(--color-brand)]" />
    </div>
  );

  const scoreColor = data.performance_score >= 80 ? "var(--color-accent)" : data.performance_score >= 60 ? "var(--color-warning)" : "var(--color-danger)";
  const earnedBadges = data.badges.filter((b) => b.earned);

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-2">
      {/* Score hero */}
      <div className="card overflow-hidden p-0">
        <div className="flex flex-col items-center gap-2 p-7 text-center" style={{ background: `linear-gradient(135deg, ${scoreColor}22, ${scoreColor}11)` }}>
          <Trophy size={40} style={{ color: scoreColor }} />
          <h1 className="text-2xl font-extrabold text-[var(--color-navy)]">Experiment Complete!</h1>
          <p className="text-[var(--color-muted)]">{data.experiment_name}</p>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-6xl font-extrabold" style={{ color: scoreColor }}>{data.performance_score}</span>
            <span className="text-xl text-[var(--color-muted)]">/100</span>
          </div>
          <p className="text-sm font-semibold text-[var(--color-muted)]">Performance score</p>
        </div>

        {/* Score breakdown */}
        <div className="grid grid-cols-4 divide-x divide-black/8 border-t border-black/8">
          {[
            { label: "Steps", value: `${data.steps_completed}/${data.steps_total}` },
            { label: "Accuracy", value: `${data.accuracy_score}%` },
            { label: "Safety alerts", value: data.safety_alerts },
            { label: "Overrides", value: data.overrides },
          ].map((s) => (
            <div key={s.label} className="py-3 text-center">
              <p className="text-lg font-extrabold text-[var(--color-navy)]">{s.value}</p>
              <p className="text-xs text-[var(--color-muted)]">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-[var(--color-navy)]">
          <Star size={18} className="text-[var(--color-warning)]" /> Badges earned {earnedBadges.length}/{data.badges.length}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {data.badges.map((b) => (
            <div key={b.id} className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-center ${b.earned ? "bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30" : "bg-black/[0.03] opacity-40"}`}>
              <span className="text-2xl">{b.icon}</span>
              <p className="text-xs font-bold text-[var(--color-navy)]">{b.label}</p>
              <p className="text-[10px] text-[var(--color-muted)]">{b.description}</p>
              {b.earned && <span className="chip bg-[var(--color-warning)]/20 text-[var(--color-warning)]">Earned ✓</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Mistakes detected */}
      {data.mistakes.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-3 font-bold text-[var(--color-navy)]">Mistakes detected</h3>
          <ul className="space-y-1.5">
            {data.mistakes.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
                <span className="mt-0.5 shrink-0 text-[var(--color-danger)]">✗</span> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Concepts learned */}
      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-[var(--color-navy)]">
          <BookOpen size={18} className="text-[var(--color-brand)]" /> Concepts learned
        </h3>
        <ul className="space-y-1.5">
          {data.concepts_learned.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0 text-[var(--color-accent)]">✓</span> {c}
            </li>
          ))}
        </ul>
      </div>

      {/* Improvement suggestions */}
      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-[var(--color-navy)]">
          <Lightbulb size={18} className="text-[var(--color-warning)]" /> Improvement suggestions
        </h3>
        <ul className="space-y-1.5">
          {data.improvement_suggestions.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[var(--color-muted)]">
              <span className="mt-0.5 shrink-0 text-[var(--color-warning)]">→</span> {s}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      <div className="flex gap-3">
        <Link href={`/lab/${sessionId}/report`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3.5 font-semibold text-white">
          <Target size={18} /> View full report <ArrowRight size={16} />
        </Link>
        <Link href="/student/join" className="flex items-center gap-2 rounded-xl border border-black/12 px-4 font-semibold text-[var(--color-navy)]">
          New lab
        </Link>
      </div>
    </div>
  );
}
