"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PrelabQuiz, QuizResult } from "@/server/tools/prelab-quiz";

export default function PrelabPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const { data: quiz, isLoading } = useQuery<PrelabQuiz>({
    queryKey: ["prelab", sessionId],
    queryFn: async () => (await fetch(`/api/lab/${sessionId}/prelab`)).json(),
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/lab/${sessionId}/prelab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      return res.json() as Promise<QuizResult>;
    },
    onSuccess: setResult,
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 animate-spin text-[var(--color-brand)]" size={32} />
        <p className="text-sm text-[var(--color-muted)]">Generating pre-lab quiz…</p>
      </div>
    </div>
  );

  if (!quiz) return null;

  // Result screen
  if (result) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-4">
        <div className={`card p-7 text-center ${result.passed ? "border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5" : "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5"}`}>
          {result.passed
            ? <CheckCircle2 size={44} className="mx-auto mb-3 text-[var(--color-accent)]" />
            : <XCircle size={44} className="mx-auto mb-3 text-[var(--color-danger)]" />}
          <h2 className="text-2xl font-extrabold text-[var(--color-navy)]">
            {result.passed ? "Ready to start!" : "Review needed"}
          </h2>
          <p className="mt-1 text-[var(--color-muted)]">
            You scored <strong>{result.score}%</strong> ({result.correct}/{result.total} correct)
          </p>
          {!result.passed && (
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Passing score is {quiz.passing_score}%. Review the explanations below and try again.
            </p>
          )}
        </div>

        {/* Per-question feedback */}
        <div className="space-y-3">
          {quiz.questions.map((q, i) => {
            const fb = result.feedback.find((f) => f.question_id === q.id);
            return (
              <div key={q.id} className={`card p-4 ${fb?.correct ? "border-[var(--color-accent)]/20" : "border-[var(--color-danger)]/20"}`}>
                <div className="flex items-start gap-2">
                  {fb?.correct
                    ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
                    : <XCircle size={16} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />}
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-navy)]">Q{i + 1}. {q.question}</p>
                    {!fb?.correct && (
                      <p className="mt-1 text-xs text-[var(--color-muted)]">
                        Correct: <strong>{q.options[q.correct]}</strong>
                      </p>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-brand)]">{fb?.explanation}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3">
          {result.passed ? (
            <button
              onClick={() => router.push(`/lab/${sessionId}/overview`)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] py-4 font-bold text-white"
            >
              Continue to experiment <ChevronRight size={18} />
            </button>
          ) : (
            <button
              onClick={() => { setResult(null); setAnswers({}); }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-4 font-bold text-white"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const answered = Object.keys(answers).length;
  const allAnswered = answered === quiz.questions.length;

  return (
    <div className="mx-auto max-w-xl space-y-5 py-4">
      <div className="hero-gradient rounded-[var(--radius-card)] p-6 text-white">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={20} />
          <span className="font-semibold">Pre-Lab Quiz</span>
        </div>
        <h2 className="text-xl font-extrabold">Check your readiness</h2>
        <p className="mt-1 text-sm text-white/70">Answer {quiz.questions.length} questions before starting. Pass {quiz.passing_score}% to proceed.</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(answered / quiz.questions.length) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-white/60">{answered}/{quiz.questions.length} answered</p>
      </div>

      {quiz.questions.map((q, i) => (
        <div key={q.id} className="card p-5">
          <p className="mb-3 font-semibold text-[var(--color-navy)]">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-brand)]/10 text-xs font-bold text-[var(--color-brand)]">{i + 1}</span>
            {q.question}
          </p>
          <div className="space-y-2">
            {q.options.map((opt, j) => (
              <button
                key={j}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: j }))}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${
                  answers[q.id] === j
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/8 font-semibold text-[var(--color-navy)]"
                    : "border-black/10 text-[var(--color-muted)] hover:border-black/25"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${answers[q.id] === j ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : "border-black/20 text-[var(--color-muted)]"}`}>
                  {["A", "B", "C", "D"][j]}
                </span>
                {opt}
              </button>
            ))}
          </div>
        </div>
      ))}

      <button
        onClick={() => submit.mutate()}
        disabled={!allAnswered || submit.isPending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-4 font-bold text-white disabled:opacity-40"
      >
        {submit.isPending ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />}
        {submit.isPending ? "Checking answers…" : "Submit quiz"}
      </button>
    </div>
  );
}
