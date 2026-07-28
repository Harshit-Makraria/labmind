"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, GraduationCap, Lightbulb, Loader2, Sparkles, Stethoscope } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import type { InterpretResult, ResultSeverity } from "@/lib/types";

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
  // Triplicate concordance only makes physical sense for titrations — a gel
  // read or a kinetics rate is a single measurement, not three burette runs.
  const isTitration = session?.protocol.experiment_id === "acid-base-titration";

  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [theo, setTheo] = useState("");
  const [result, setResult] = useState<InterpretResult | null>(null);
  const { titres, setTitres, allFilled, outlierIndex, mean, deviationOfOutlier } = useTitres();

  useEffect(() => {
    if (theoretical) {
      setUnit(theoretical.unit);
      setTheo(String(theoretical.value));
    }
  }, [theoretical]);

  const submit = useMutation({
    mutationFn: () =>
      api.interpret({
        session_id: sessionId,
        student_result: isTitration ? (mean as number) : Number.parseFloat(value),
        unit,
        theoretical_value: Number.parseFloat(theo),
        experiment_id: session?.protocol.experiment_id,
      }),
    onSuccess: setResult,
    onError: (e) => toast.error((e as Error).message),
  });

  const valid = isTitration
    ? allFilled && mean !== null
    : value !== "" && !Number.isNaN(Number.parseFloat(value));

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
            <span className="text-2xl font-extrabold">{result.deviation_percent}%</span>
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
            {isTitration ? "Enter your three titres" : "Enter your result"}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {isTitration
              ? "LabMind checks whether two of your three replicates agree, then compares the mean to the expected value."
              : "LabMind compares it to the expected value and explains any deviation."}
          </p>
        </div>

        {isTitration ? (
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
                    className="font-data min-h-[48px] flex-1 rounded-[var(--radius-btn)] border-2 px-3 text-[15px] outline-none transition-colors focus:border-[var(--color-brand)]"
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
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-semibold text-[var(--color-navy)]">
              {theoretical?.label ?? "Your calculated result"}
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. 0.094"
                className="font-data min-h-[52px] flex-[2] rounded-[var(--radius-btn)] border border-black/15 px-4 text-lg outline-none focus:border-[var(--color-brand)]"
              />
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="min-h-[52px] flex-1 rounded-[var(--radius-btn)] border border-black/15 px-3 text-center outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-[var(--color-navy)]">Expected value</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={theo}
            onChange={(e) => setTheo(e.target.value)}
            className="mt-1 min-h-[52px] w-full rounded-[var(--radius-btn)] border border-black/15 px-4 text-lg outline-none focus:border-[var(--color-brand)]"
          />
          {theoretical && (
            <span className="mt-1 block text-xs text-[var(--color-muted)]">
              {session?.protocol.experiment_name} expects ≈ {theoretical.value} {theoretical.unit}.
            </span>
          )}
        </label>

        <Button onClick={() => submit.mutate()} disabled={!valid || submit.isPending}>
          {submit.isPending ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {submit.isPending ? "Analyzing…" : "Analyze my result"}
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
