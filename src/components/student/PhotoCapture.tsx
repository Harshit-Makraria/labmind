"use client";

import { useMutation } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock, Loader2, PencilLine, RefreshCw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProgressBar } from "@/components/student/ProgressBar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { ApiError, api } from "@/lib/api-client";
import { VISION_HIGH_CONFIDENCE } from "@/lib/types";
import type { VisionExpected, VisionResult } from "@/lib/types";

const FALLBACK_EXPECTED: VisionExpected = { type: "burette_reading", expected_value: null, tolerance: 0.1 };

/**
 * Animated confidence bar with a marker at the auto-verify threshold, so the
 * student sees exactly how close their read came to auto-passing. The marker
 * position is THIS student's actual adaptive bar (0.78–0.94, from the risk
 * engine) — not a fixed global constant — so it always matches what really
 * gated their submission.
 */
function ConfidenceBar({ confidence, tone, threshold }: { confidence: number; tone: string; threshold?: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${pct}%`, backgroundColor: tone }} />
      <span className="progress-marker" style={{ left: `${(threshold ?? VISION_HIGH_CONFIDENCE) * 100}%` }} />
    </div>
  );
}

// These name the ACTUAL server-side pipeline stages (image-quality.ts,
// image-crop.ts, vision-ensemble.ts, physical-constraints.ts) — not invented
// theater. The request usually finishes before the cycle completes once.
const CHECK_STAGES = [
  "Checking image quality…",
  "Locating the instrument…",
  "Reading with the AI ensemble…",
  "Cross-checking against physics…",
];

function VerifyingPanel() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStage((s) => Math.min(s + 1, CHECK_STAGES.length - 1)), 1100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="anim-fade-up flex flex-col gap-3 rounded-[var(--radius-btn)] border border-black/[0.06] bg-black/[0.015] p-4">
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-[var(--color-brand)]" />
        <p className="text-sm font-bold text-[var(--color-navy)]">{CHECK_STAGES[stage]}</p>
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${((stage + 1) / CHECK_STAGES.length) * 100}%`, backgroundColor: "var(--color-brand)" }}
        />
      </div>
      <div className="skeleton h-3 w-3/4" />
      <div className="skeleton h-3 w-1/2" style={{ animationDelay: "0.15s" }} />
    </div>
  );
}

function imageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

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
        finish({ type: "complete_step", step_number: step!.step_number });
      } else if (res.verification_status === "retake") {
        // Image quality too poor — clear it so student must retake
        toast.warning("Image too unclear — please retake the photo", { duration: 6000 });
        setPreview(null);
        setBase64(null);
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
    } catch (e) {
      // The pre-lab gate is a deliberate server-side rejection — honour it
      // instead of advancing locally, or the gate would be trivially bypassed.
      if (e instanceof ApiError && e.body?.prelab_required) {
        toast.error("Complete the pre-lab quiz before recording steps.", { duration: 6000 });
        router.push(`/lab/${sessionId}/prelab`);
        return;
      }
      // Any other failure: advance locally so a network blip can't strand the student.
      setStepIndex(next);
      setTimeout(() => {
        router.push(next < steps.length ? `/lab/${sessionId}` : `/lab/${sessionId}/result`);
      }, 750);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    const { dataUrl, base64: b64 } = await fileToParts(file);

    // Client-side pre-check: catch an obviously unusable photo here rather than
    // after a round trip. The server runs a stricter gate; this just saves the
    // student the wait on the clearest failures.
    const dims = await imageDimensions(dataUrl).catch(() => null);
    if (dims && Math.min(dims.w, dims.h) < 500) {
      toast.warning(
        `That photo is only ${dims.w}×${dims.h}. Move closer so the scale fills the frame, then retake.`,
        { duration: 6000 },
      );
      return;
    }

    setPreview(dataUrl);
    setBase64(b64);
    setResult(null);
  }

  const canOverride = result?.manual_override_available && result?.verification_status === "failed";

  return (
    <div className="mx-auto max-w-xl py-1">
      <ProgressBar current={idx + 1} total={steps.length} />

      <div className="card anim-fade-up space-y-4 p-5">
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
          <img src={preview} alt="Captured" className="anim-scale-in max-h-72 w-full rounded-[var(--radius-btn)] object-cover" />
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => inputRef.current?.click()}
              className="relative flex w-full flex-col items-center gap-2 overflow-hidden rounded-[var(--radius-card)] border-2 border-dashed border-[var(--color-brand)]/40 bg-[var(--color-brand)]/5 p-10 text-[var(--color-brand)]"
            >
              {/* Framing guide — a tall narrow target matching a burette's shape.
                  Getting the scale to fill the frame is the single biggest factor
                  in reading accuracy, so we show the student the shape to aim for. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-4 left-1/2 w-16 -translate-x-1/2 rounded-md border-2 border-[var(--color-brand)]/30"
                style={{ borderStyle: "dashed" }}
              />
              <Camera size={32} className="relative" />
              <span className="relative font-semibold">Take / choose a photo</span>
              <span className="relative text-xs opacity-70">Fill the guide with the scale</span>
            </button>

            <div className="rounded-[var(--radius-btn)] bg-black/[0.03] px-3 py-2.5 text-xs text-[var(--color-muted)]">
              <p className="mb-1 font-semibold text-[var(--color-navy)]">For an accurate reading</p>
              <ul className="space-y-0.5">
                <li>• Hold the phone <strong>level with the liquid surface</strong> — looking down or up causes parallax error</li>
                <li>• Get close enough that the graduation numbers are readable</li>
                <li>• Avoid glare on the glass; tap the screen to focus before shooting</li>
                <li>• Make sure the clamp isn&apos;t covering the scale</li>
              </ul>
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />

        {/* RETAKE — image too poor (< 40% confidence) */}
        {result?.verification_status === "retake" && (
          <div className="anim-fade-up flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-danger)]/10 p-3 text-sm">
            <Camera size={18} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="font-bold text-[var(--color-danger)]">Image too unclear — please retake</p>
                <p className="text-[var(--color-navy)]">{result.message}</p>
              </div>
              <ConfidenceBar confidence={result.confidence} tone="var(--color-danger)" threshold={result.verification_threshold} />
              <p className="font-data text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% — too low to process. Check lighting, focus, and angle.
              </p>
            </div>
          </div>
        )}

        {/* AUTO VERIFIED — high confidence pass */}
        {result?.verification_status === "auto_verified" && (
          <div className="anim-fade-up flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-accent)]/12 p-3 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold text-[var(--color-accent)]">Auto verified ✓</p>
                {result.reading !== null && (
                  <span className="font-data text-lg font-bold text-[var(--color-navy)]">{result.reading}</span>
                )}
              </div>
              <p className="text-[var(--color-navy)]">{result.message}</p>
              <ConfidenceBar confidence={result.confidence} tone="var(--color-accent)" threshold={result.verification_threshold} />
              <p className="font-data text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% — clears your {(result.verification_threshold * 100).toFixed(0)}% auto-pass bar
              </p>
            </div>
          </div>
        )}

        {/* NEEDS REVIEW — low confidence, queued for instructor */}
        {result?.verification_status === "needs_review" && (
          <div className="anim-fade-up flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-warning)]/12 p-3 text-sm">
            <Clock size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold text-[var(--color-warning)]">Sent for instructor review</p>
                {result.reading !== null && (
                  <span className="font-data text-lg font-bold text-[var(--color-navy)]">{result.reading}</span>
                )}
              </div>
              <p className="text-[var(--color-navy)]">{result.message}</p>
              <ConfidenceBar confidence={result.confidence} tone="var(--color-warning)" threshold={result.verification_threshold} />
              <p className="font-data text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% — below your {(result.verification_threshold * 100).toFixed(0)}% bar, instructor will verify. You can continue.
              </p>
            </div>
          </div>
        )}

        {/* FAILED — bad pass, retry or manual override */}
        {result?.verification_status === "failed" && (
          <div className="anim-fade-up flex items-start gap-2 rounded-[var(--radius-btn)] bg-red-500/10 p-3 text-sm text-[var(--color-navy)]">
            <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-red-600">{result.message}</p>
                {result.reading !== null && (
                  <span className="font-data text-lg font-bold text-[var(--color-navy)]">{result.reading}</span>
                )}
              </div>
              <p className="text-[var(--color-muted)]">{result.notes}</p>
              <ConfidenceBar confidence={result.confidence} tone="var(--color-danger)" threshold={result.verification_threshold} />
              <p className="font-data text-xs text-[var(--color-muted)]">
                Confidence {(result.confidence * 100).toFixed(0)}% · attempt {result.attempts}
              </p>
            </div>
          </div>
        )}

        {verify.isPending && <VerifyingPanel />}

        {preview && !verify.isPending && (!result || result.verification_status === "failed") && (
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
            <Button onClick={() => verify.mutate()} className="flex-[2]">
              <CheckCircle2 size={18} /> Verify with AI
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
