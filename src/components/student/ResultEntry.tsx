"use client";

import { useMutation } from "@tanstack/react-query";
import { GraduationCap, Lightbulb, Loader2, Sparkles, Stethoscope } from "lucide-react";
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

export function ResultEntry({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { session } = useSession(sessionId);
  const theoretical = session?.protocol.theoretical;

  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [theo, setTheo] = useState("");
  const [result, setResult] = useState<InterpretResult | null>(null);

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
        student_result: Number.parseFloat(value),
        unit,
        theoretical_value: Number.parseFloat(theo),
        experiment_id: session?.protocol.experiment_id,
      }),
    onSuccess: setResult,
    onError: (e) => toast.error((e as Error).message),
  });

  const valid = value !== "" && !Number.isNaN(Number.parseFloat(value));

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
      <div className="card space-y-4 p-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-navy)]">Enter your result</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            LabMind compares it to the expected value and explains any deviation.
          </p>
        </div>

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
              className="min-h-[52px] flex-[2] rounded-[var(--radius-btn)] border border-black/15 px-4 text-lg outline-none focus:border-[var(--color-brand)]"
            />
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="min-h-[52px] flex-1 rounded-[var(--radius-btn)] border border-black/15 px-3 text-center outline-none focus:border-[var(--color-brand)]"
            />
          </div>
        </label>

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
