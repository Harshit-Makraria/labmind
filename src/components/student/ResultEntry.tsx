"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, GraduationCap, Lightbulb, Loader2, Sparkles, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import type { InterpretResult, ResultKind, ResultSeverity } from "@/lib/types";

const THEME: Record<ResultSeverity, { color: string; label: string }> = {
  green: { color: "var(--color-accent)", label: "On target" },
  amber: { color: "var(--color-warning)", label: "Close — needs a tweak" },
  red: { color: "var(--color-danger)", label: "Significant deviation" },
};

// Mirrors the 0.1 mL concordance threshold in server/tools/instrument-spec.ts
// (kept as a local constant rather than a shared import since that module is
// server-only). Real titrations are run in triplicate and graded on whether
// two of the three readings agree within this window — the same standard the
// vision pipeline's physics check already applies to submitted photos.
const TITRE_CONCORDANCE_ML = 0.1;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Stoichiometry constants straight from the titration protocol itself
// (titration.ts): step 1 fills the burette with 0.1M NaOH, step 2 pipettes
// 25.0 mL of the unknown HCl. C(HCl) = C(NaOH) × V(NaOH titre) / V(HCl) is
// the same n = C×V, 1:1 mole ratio, C = n/0.025 L formula step 6 states,
// just expressed as one ratio so mL cancels without a separate conversion.
// Without this, the raw titre volume (~24–25 mL) was being submitted AS the
// result and compared straight against the 0.1 mol/L theoretical value,
// producing nonsense deviations in the tens of thousands of percent.
const NAOH_MOLARITY_M = 0.1;
const HCL_VOLUME_ML = 25.0;

function useTitres() {
  const [titres, setTitres] = useState(["", "", ""]);
  const values = titres.map((t) => Number.parseFloat(t)).filter((n) => !Number.isNaN(n));
  const allFilled = titres.every((t) => t !== "" && !Number.isNaN(Number.parseFloat(t)));

  let concordant: number[] = [];
  let outlierIndex: number | null = null;
  let mean: number | null = null;

  if (allFilled && values.length === 3) {
    // Find the pair with the smallest spread — that's the concordant set.
    const pairs: [number, number, number][] = [[0, 1, Math.abs(values[0] - values[1])], [0, 2, Math.abs(values[0] - values[2])], [1, 2, Math.abs(values[1] - values[2])]];
    pairs.sort((a, b) => a[2] - b[2]);
    const [i, j, spread] = pairs[0];
    if (spread <= TITRE_CONCORDANCE_ML) {
      concordant = [values[i], values[j]];
      outlierIndex = [0, 1, 2].find((k) => k !== i && k !== j) ?? null;
      mean = round2((values[i] + values[j]) / 2);
    } else {
      // Nothing agrees — fall back to the mean of all three, unflagged.
      mean = round2(values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  return { titres, setTitres, allFilled, outlierIndex, mean, deviationOfOutlier: outlierIndex !== null && mean !== null ? round2(Math.abs(values[outlierIndex] - mean)) : null };
}

export function ResultEntry({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { session } = useSession(sessionId);
  const theoretical = session?.protocol.theoretical;
  // What this experiment actually asks for. A custom (uploaded or hand-built)
  // protocol declares its own expected result, which may not be a number at
  // all — a microscopy practical ends in an identification, a circuit test in
  // a yes/no. Library experiments carry a numeric target on `theoretical`, so
  // that's the fallback.
  const expected = session?.protocol.expected_result ?? null;
  const kind: ResultKind = expected?.kind ?? "numeric";
  // Triplicate concordance only makes physical sense for titrations — a gel
  // read or a kinetics rate is a single measurement, not three burette runs.
  const isTitration = session?.protocol.experiment_id === "acid-base-titration";

  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [unit, setUnit] = useState("");
  const [theo, setTheo] = useState("");
  const [result, setResult] = useState<InterpretResult | null>(null);
  const { titres, setTitres, allFilled, outlierIndex, mean, deviationOfOutlier } = useTitres();
  // The mean titre is a VOLUME (mL) — step 8 of the protocol asks for the
  // calculated CONCENTRATION (mol/L), so this conversion has to happen
  // before submission, not after. Submitting the raw mL mean as if it were
  // the concentration is what produced the ~24,000%+ deviations.
  const concentration = mean !== null ? (NAOH_MOLARITY_M * mean) / HCL_VOLUME_ML : null;

  useEffect(() => {
    // Prefer the experiment's own declared target; fall back to the library
    // experiment's theoretical value for the built-in protocols.
    if (expected?.kind === "numeric" && typeof expected.value === "number") {
      setUnit(expected.unit ?? "");
      setTheo(String(expected.value));
    } else if (theoretical) {
      setUnit(theoretical.unit);
      setTheo(String(theoretical.value));
    }
  }, [theoretical, expected]);

  const submit = useMutation({
    mutationFn: () =>
      api.interpret({
        session_id: sessionId,
        // Non-numeric experiments still send a number (the server ignores it
        // for those kinds) so the existing request shape stays valid.
        student_result: kind !== "numeric" ? 0 : isTitration ? (concentration as number) : Number.parseFloat(value),
        student_answer: kind === "numeric" ? null : kind === "boolean" ? answer === "yes" : answer,
        unit,
        theoretical_value: Number.parseFloat(theo) || 0,
        experiment_id: session?.protocol.experiment_id,
      }),
    onSuccess: setResult,
    onError: (e) => toast.error((e as Error).message),
  });

  const valid =
    kind === "none"
      ? true
      : kind === "numeric"
        ? isTitration
          ? allFilled && concentration !== null
          : value !== "" && !Number.isNaN(Number.parseFloat(value))
        : answer.trim() !== "";

  // Deep-linking straight to /result (session expired, sessionStorage cleared,
  // a stale bookmark) previously fell through to a generic, contextless form
  // with no experiment name and the wrong input mode — matching the guard
  // PhotoCapture.tsx and the step-card page already use for the same case.
  if (!session) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <Loader2 className="animate-spin" />
        <p>Loading your lab session…</p>
        <button onClick={() => router.push("/library")} className="text-sm text-[var(--color-brand)] underline">
          Choose an experiment
        </button>
      </div>
    );
  }

  if (result) {
    const theme = THEME[result.severity];
    return (
      <div className="mx-auto max-w-xl py-1">
        <div className="card space-y-4 overflow-hidden p-5">
          <div
            className="-mx-5 -mt-5 mb-1 flex items-center justify-between px-5 py-4 text-white"
            style={{ backgroundColor: theme.color }}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={20} />
              <span className="font-bold">{theme.label}</span>
            </div>
            {/* Only a numeric result has a "percent off". A categorical or
                yes/no answer reports correct/incorrect; a written observation
                is pending the instructor, so it claims neither. */}
            <span className="text-2xl font-extrabold">
              {result.deviation_percent !== null
                ? `${result.deviation_percent}%`
                : result.correct === true
                  ? "Correct"
                  : result.correct === false
                    ? "Incorrect"
                    : "Recorded"}
            </span>
          </div>

          <Block icon={Stethoscope} title="Diagnosis" body={result.diagnosis} />
          <Block icon={Lightbulb} title="How to improve" body={result.improvement} />
          <Block icon={GraduationCap} title="Learning point" body={result.learning_point} />

          <div className="flex flex-col gap-2 pt-1">
            <Button onClick={() => router.push(`/lab/${sessionId}/summary`)}>
              View your summary &amp; badges
            </Button>
            <Button variant="ghost" onClick={() => router.push("/library")}>
              Run another experiment
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-1">
      <div className="card anim-fade-up space-y-4 p-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy)]">
            {kind === "none"
              ? "Finish your experiment"
              : kind === "qualitative"
                ? "Record your observation"
                : kind === "categorical" || kind === "boolean"
                  ? (expected?.label ?? "Your conclusion")
                  : isTitration
                    ? "Enter your three titres"
                    : "Enter your result"}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {kind === "none"
              ? "This experiment is assessed on your step-by-step work — no final value to enter."
              : kind === "qualitative"
                ? "Describe what you actually observed. Your instructor reviews this against the expected observation."
                : kind === "categorical" || kind === "boolean"
                  ? "Choose the answer your evidence supports."
                  : isTitration
                    ? "LabMind checks whether two of your three replicates agree, then compares the mean to the expected value."
                    : "LabMind compares it to the expected value and explains any deviation."}
          </p>
        </div>

        {kind === "categorical" ? (
          <div className="space-y-2">
            {(expected?.options ?? []).map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-btn)] border-2 px-4 py-3 transition-colors"
                style={{ borderColor: answer === opt ? "var(--color-brand)" : "rgba(15,41,66,.12)" }}
              >
                <input type="radio" name="result-option" value={opt} checked={answer === opt} onChange={(e) => setAnswer(e.target.value)} />
                <span className="text-[15px] text-[var(--color-navy)]">{opt}</span>
              </label>
            ))}
          </div>
        ) : kind === "boolean" ? (
          <div className="flex gap-3">
            {["yes", "no"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setAnswer(opt)}
                className="flex-1 rounded-[var(--radius-btn)] border-2 py-3 font-semibold capitalize transition-colors"
                style={{
                  borderColor: answer === opt ? "var(--color-brand)" : "rgba(15,41,66,.12)",
                  color: answer === opt ? "var(--color-brand)" : "var(--color-navy)",
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : kind === "qualitative" ? (
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-navy)]">{expected?.label ?? "Your observation"}</span>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              placeholder="Describe exactly what you observed…"
              className="mt-1 w-full rounded-[var(--radius-btn)] border border-black/15 px-4 py-3 text-[15px] outline-none focus:border-[var(--color-brand)]"
            />
            {expected?.rubric && (
              <span className="mt-1 block text-xs text-[var(--color-muted)]">Your instructor is looking for: {expected.rubric}</span>
            )}
          </label>
        ) : kind === "none" ? (
          <p className="rounded-[var(--radius-btn)] bg-black/[0.03] p-4 text-sm text-[var(--color-muted)]">
            Nothing to enter here — submit to generate your report.
          </p>
        ) : isTitration ? (
          <div className="space-y-2">
            {titres.map((t, i) => {
              const isOutlier = outlierIndex === i;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className="w-16 shrink-0 text-sm font-semibold"
                    style={{ color: isOutlier ? "var(--color-warning)" : "var(--color-muted)" }}
                  >
                    Titre {i + 1}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={t}
                    onChange={(e) => setTitres((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
                    placeholder="e.g. 24.50"
                    className="font-data min-h-[48px] min-w-0 flex-1 rounded-[var(--radius-btn)] border-2 px-3 text-[15px] outline-none transition-colors focus:border-[var(--color-brand)]"
                    style={{ borderColor: isOutlier ? "var(--color-warning)" : "rgba(15,41,66,.12)" }}
                  />
                  <span className="text-sm font-medium text-[var(--color-muted)]">mL</span>
                </div>
              );
            })}

            {outlierIndex !== null && deviationOfOutlier !== null && (
              <div className="anim-fade-up flex items-start gap-2 rounded-[var(--radius-btn)] border-l-[3px] border-[var(--color-warning)] bg-[var(--color-warning)]/12 p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
                <div>
                  <p className="text-sm font-bold text-[var(--color-warning)]">Titre {outlierIndex + 1} is discordant</p>
                  <p className="font-data mt-0.5 text-xs leading-relaxed text-[var(--color-navy)]">
                    {deviationOfOutlier} mL from the mean of the other two — outside the {TITRE_CONCORDANCE_ML} mL
                    concordance window. Repeat it, or keep it and note why in your report.
                  </p>
                </div>
              </div>
            )}

            {mean !== null && (
              <div className="flex justify-between border-t border-black/[0.08] pt-2.5">
                <span className="text-sm font-semibold text-[var(--color-muted)]">
                  {outlierIndex !== null ? "Concordant mean" : "Mean titre"}
                </span>
                <span className="font-data text-lg font-bold text-[var(--color-navy)]">{mean} mL</span>
              </div>
            )}

            {concentration !== null && (
              <div className="flex justify-between border-t border-black/[0.08] pt-2.5">
                <span className="text-sm font-semibold text-[var(--color-muted)]">Calculated C(HCl)</span>
                <span className="font-data text-lg font-bold text-[var(--color-navy)]">{round4(concentration)} mol/L</span>
              </div>
            )}
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-navy)]">
              {expected?.label ?? theoretical?.label ?? "Your calculated result"}
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 0.094"
                className="font-data min-h-[52px] min-w-0 flex-[2] rounded-[var(--radius-btn)] border border-black/15 px-4 text-lg outline-none focus:border-[var(--color-brand)]"
              />
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="min-h-[52px] min-w-0 flex-1 rounded-[var(--radius-btn)] border border-black/15 px-3 text-center outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          </label>
        )}

        {/* Only meaningful for a numeric target — there's no "expected value"
            to show for an identification or a written observation, and the
            answer key must never be shown for those anyway. */}
        {kind === "numeric" && (
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-navy)]">Expected value</span>
            {/* Read-only: this is the experiment's real target, graded server-side —
                it's shown for context, not something you can shift to flatter your result. */}
            <input
              type="number"
              value={theo}
              readOnly
              disabled
              className="mt-1 min-h-[52px] w-full cursor-not-allowed rounded-[var(--radius-btn)] border border-black/15 bg-black/[0.03] px-4 text-lg text-[var(--color-muted)] outline-none"
            />
            {theo !== "" && (
              <span className="mt-1 block text-xs text-[var(--color-muted)]">
                {session?.protocol.experiment_name} expects ≈ {theo} {unit}.
              </span>
            )}
          </label>
        )}

        <Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}>
          {submit.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {submit.isPending ? "Analyzing…" : kind === "numeric" ? "Analyze my result" : "Submit my answer"}
        </Button>
      </div>
    </div>
  );
}

function Block({ icon: Icon, title, body }: { icon: typeof Stethoscope; title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-btn)] bg-black/[0.03] p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-bold text-[var(--color-navy)]">
        <Icon size={16} className="text-[var(--color-brand)]" />
        {title}
      </div>
      <p className="text-sm leading-snug text-[var(--color-ink)]/80">{body}</p>
    </div>
  );
}
