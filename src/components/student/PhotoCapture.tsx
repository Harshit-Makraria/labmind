"use client";

import { useMutation } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock, Loader2, PencilLine, RefreshCw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ProgressBar } from "@/components/student/ProgressBar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import type { VisionExpected, VisionResult } from "@/lib/types";

const FALLBACK_EXPECTED: VisionExpected = { type: "burette_reading", expected_value: null, tolerance: 0.1 };

function fileToParts(file: File): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve({ dataUrl, base64: dataUrl.split(",")[1] ?? "" });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PhotoCapture({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { session, setStepIndex } = useSession(sessionId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [overrideValue, setOverrideValue] = useState("");

  const verify = useMutation({
    mutationFn: () =>
      api.checkVision({
        session_id: sessionId,
        step_number: step?.step_number ?? 0,
        image_base64: base64 ?? "",
        expected: step?.vision_expected ?? FALLBACK_EXPECTED,
        experiment_id: session?.protocol.experiment_id,
      }),
    onSuccess: (res) => {
      setResult(res);
      if (res.verification_status === "auto_verified") {
        toast.success("✅ High confidence — auto verified!");
        finish({ type: "complete_step", step_number: step!.step_number });
      } else if (res.verification_status === "needs_review") {
        toast("🔍 Sent for instructor review — you can continue", { duration: 5000 });
        // Allow student to continue even while review is pending
        finish({ type: "complete_step", step_number: step!.step_number });
      }
      // "failed" → stay on page, show retry / manual override UI
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!session) {
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <Loader2 className="animate-spin" />
        <button onClick={() => router.push("/library")} className="text-sm text-[var(--color-brand)] underline">
          Choose an experiment
        </button>
      </div>
    );
  }

  const steps = session.protocol.steps;
  const idx = session.currentStepIndex;
  const step = steps[idx];

  async function finish(action: Parameters<typeof api.sessionAction>[1]) {
    const next = idx + 1;
    try {
      const res = await api.sessionAction(sessionId, action);
      if (res.pending_verification) {
        toast.success("Manual override queued — awaiting instructor verification");
        // do not advance the student; show message and keep them on the current step
        return;
      }
      setStepIndex(next);
      setTimeout(() => {
        router.push(next < steps.length ? `/lab/${sessionId}` : `/lab/${sessionId}/result`);
      }, 750);
    } catch {
      // best-effort: advance locally even if the server failed
      setStepIndex(next);
      setTimeout(() => {
        router.push(next < steps.length ? `/lab/${sessionId}` : `/lab/${sessionId}/result`);
      }, 750);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    const { dataUrl, base64: b64 } = await fileToParts(file);
    setPreview(dataUrl);
    setBase64(b64);
    setResult(null);
  }

  const canOverride = result?.manual_override_available && result?.verification_status === "failed";

  return (
    <div className="mx-auto max-w-xl py-1">
      <ProgressBar current={idx + 1} total={steps.length} />

      <div className="card space-y-4 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
            Step {step.step_number} · Photo verification
          </p>
          <h1 className="text-xl font-bold text-[var(--color-navy)]">{step.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Capture: {step.expected_observation || "the current reading"}
          </p>
        </div>

        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Captured" className="max-h-72 w-full rounded-[var(--radius-btn)] object-cover" />
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5 p-10 text-[var(--color-brand)]"
          >
            <Camera size={32} />
            <span className="font-semibold">Take / choose a photo</span>
            <span className="text-xs opacity-70">Point at the burette, gel, or flask</span>
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />

        {/* AUTO VERIFIED — high confidence pass */}
        {result?.verification_status === "auto_verified" && (
          <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-accent)]/12 p-3 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <div>
              <p className="font-bold text-[var(--color-accent)]">Auto verified ✓</p>
              <p className="text-[var(--color-navy)]">{result.message}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% — high enough to auto-pass
              </p>
            </div>
          </div>
        )}

        {/* NEEDS REVIEW — low confidence, queued for instructor */}
        {result?.verification_status === "needs_review" && (
          <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-warning)]/12 p-3 text-sm">
            <Clock size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <div>
              <p className="font-bold text-[var(--color-warning)]">Sent for instructor review</p>
              <p className="text-[var(--color-navy)]">{result.message}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% — below threshold, instructor will verify. You can continue.
              </p>
            </div>
          </div>
        )}

        {/* FAILED — bad pass, retry or manual override */}
        {result?.verification_status === "failed" && (
          <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-red-500/10 p-3 text-sm text-[var(--color-navy)]">
            <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="font-semibold text-red-600">{result.message}</p>
              <p className="mt-0.5 text-[var(--color-muted)]">{result.notes}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% · attempt {result.attempts}
              </p>
            </div>
          </div>
        )}

        {preview && (!result || result.verification_status === "failed") && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              fullWidth={false}
              onClick={() => {
                setPreview(null);
                setBase64(null);
                setResult(null);
              }}
              className="flex-1"
            >
              <RefreshCw size={16} /> Retake
            </Button>
            <Button onClick={() => verify.mutate()} disabled={verify.isPending} className="flex-[2]">
              {verify.isPending ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              {verify.isPending ? "Checking…" : "Verify with AI"}
            </Button>
          </div>
        )}

        {/* Manual override unlocks after 2 failed attempts (spec §2.2). */}
        {canOverride && (
          <div className="rounded-[var(--radius-btn)] border border-black/10 bg-black/[0.02] p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-navy)]">
              <PencilLine size={15} /> Enter the reading manually
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Two low-confidence captures — you can record the value yourself; the instructor is notified.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="number"
                step="any"
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                placeholder="e.g. 24.5"
                className="min-h-[44px] flex-1 rounded-[var(--radius-btn)] border border-black/15 px-3 outline-none focus:border-[var(--color-brand)]"
              />
              <Button
                fullWidth={false}
                variant="secondary"
                className="px-4"
                disabled={overrideValue === ""}
                onClick={() =>
                  finish({
                    type: "manual_override",
                    step_number: step.step_number,
                    value: Number.parseFloat(overrideValue),
                    note: "Student-entered after 2 failed vision checks — send for instructor verification",
                  })
                }
              >
                Save &amp; continue
              </Button>
            </div>
          </div>
        )}

        <button
          onClick={() => finish({ type: "complete_step", step_number: step.step_number })}
          className="w-full text-center text-xs font-medium text-[var(--color-muted)] hover:underline"
        >
          Can&apos;t capture right now — skip check
        </button>
      </div>
    </div>
  );
}
