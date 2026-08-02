"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantDock } from "@/components/assistant/AssistantDock";
import { SafetyModal } from "@/components/student/SafetyModal";
import { StepCard } from "@/components/student/StepCard";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import type { SafetyResult } from "@/lib/types";

export default function LabPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const router = useRouter();
  const { session, setStepIndex } = useSession(sessionId);

  const [safety, setSafety] = useState<SafetyResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const dismissed = useRef<Set<number>>(new Set());

  const experimentId = session?.protocol.experiment_id;
  const steps = session?.protocol.steps ?? [];
  const idx = session?.currentStepIndex ?? 0;
  // Once the last step completes, currentStepIndex advances to steps.length
  // and the experiment redirects to /result. Pressing browser Back then
  // reloads this page with an out-of-range index — step/currentStep would be
  // undefined and every access below (step.vision_check_required, step.title
  // inside StepCard, etc.) would throw. Redirect back to /result instead of
  // rendering with no step.
  const currentStep = idx < steps.length ? steps[idx] : null;
  const stepNumber = currentStep?.step_number;

  useEffect(() => {
    if (session && idx >= steps.length) router.replace(`/lab/${sessionId}/result`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, idx, steps.length]);

  // Server-side flag state (which steps became unreliable after a skip), and
  // this step's skip-request status when the session has an instructor.
  const { data: detail } = useQuery({
    queryKey: ["session-detail", sessionId, stepNumber],
    queryFn: () => api.sessionDetail(sessionId),
    refetchInterval: 4000,
    enabled: !!session,
  });
  const flaggedSteps = new Set((detail?.steps ?? []).filter((s) => s.flagged).map((s) => s.step_number));

  const skipRequest = detail?.skip_request ?? null;
  const pendingSkipSeconds =
    skipRequest && skipRequest.step_number === stepNumber && skipRequest.seconds_remaining > 0
      ? skipRequest.seconds_remaining
      : null;

  // A request for THIS step just resolved — either the instructor approved it
  // (the step's own record flips to "skipped") or the 60s window ran out with
  // no response. Both cases need to move the student out of the "waiting"
  // state; only fire once per transition, not on every 4s poll. Navigation is
  // inlined here (rather than calling advance(), defined further below)
  // because a hoisted function declaration would work but reads as a forward
  // reference — this keeps the effect self-contained.
  const wasWaitingRef = useRef(false);
  useEffect(() => {
    const stillWaiting = pendingSkipSeconds !== null;
    if (wasWaitingRef.current && !stillWaiting) {
      const approved = (detail?.steps ?? []).find((s) => s.step_number === stepNumber)?.state === "skipped";
      if (approved) {
        toast.success(`Instructor approved — step ${stepNumber} skipped`);
        if (idx + 1 < steps.length) setStepIndex(idx + 1);
        else router.push(`/lab/${sessionId}/result`);
      } else {
        toast("Instructor didn't respond in time — please complete this step yourself.", { icon: "⏳", duration: 5000 });
      }
    }
    wasWaitingRef.current = stillWaiting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSkipSeconds, detail]);

  // Feature 3: run the safety engine whenever the active step changes.
  useEffect(() => {
    if (!session || !currentStep) return;
    let cancelled = false;
    setShowModal(false);
    api
      .checkSafety({
        session_id: sessionId,
        step_number: currentStep.step_number,
        reagents: currentStep.reagents,
        experiment_id: experimentId,
      })
      .then((res) => {
        if (cancelled) return;
        setSafety(res);
        if (res.conflict && !dismissed.current.has(currentStep.step_number)) setShowModal(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, stepNumber]);

  if (!session || !currentStep) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <Loader2 className="animate-spin" />
        <p>{session ? "Finishing up…" : "Loading your lab session…"}</p>
        {!session && (
          <button onClick={() => router.push("/library")} className="text-sm text-[var(--color-brand)] underline">
            Choose an experiment
          </button>
        )}
      </div>
    );
  }

  const step = currentStep;

  function advance(next: number) {
    if (next < steps.length) setStepIndex(next);
    else router.push(`/lab/${sessionId}/result`);
  }

  function complete() {
    if (step.vision_check_required) {
      router.push(`/lab/${sessionId}/photo`);
      return;
    }
    api.sessionAction(sessionId, { type: "complete_step", step_number: step.step_number }).catch(() => {});
    if (idx + 1 < steps.length) toast.success(`Step ${idx + 1} complete`);
    advance(idx + 1);
  }

  function skip() {
    if (detail?.instructor_code) {
      // Instructor-led session — queue a request instead of skipping outright;
      // stay on this step until the poll above sees it approved or expired.
      api.sessionAction(sessionId, { type: "request_skip", step_number: step.step_number }).catch(() => {});
      toast("Skip request sent — waiting for your instructor to approve it.", { icon: "⏳" });
      return;
    }
    api.sessionAction(sessionId, { type: "skip_step", step_number: step.step_number }).catch(() => {});
    toast(`Step ${step.step_number} skipped — downstream steps may be flagged`, { icon: "⚠️" });
    advance(idx + 1);
  }

  const dockSuggestions = [
    step.reagents.length ? `Is it safe to use ${step.reagents.map((r) => r.name).join(" and ")} here?` : "Is this step safe?",
    "Why does this step matter?",
    step.vision_expected ? "What reading should I expect?" : "What should I observe?",
  ];

  return (
    <div className="mx-auto max-w-2xl py-1">
      <p className="mb-3 text-center text-sm font-semibold text-[var(--color-brand)]">
        {session.protocol.experiment_name}
      </p>

      <StepCard
        step={step}
        current={idx + 1}
        total={steps.length}
        flagged={flaggedSteps.has(step.step_number)}
        onComplete={complete}
        onSkip={skip}
        skipRequiresApproval={!!detail?.instructor_code}
        pendingSkipSeconds={pendingSkipSeconds}
      />

      <AssistantDock
        sessionId={sessionId}
        experimentId={experimentId}
        currentStep={step.step_number}
        suggestions={dockSuggestions}
      />

      <AnimatePresence>
        {showModal && safety?.conflict && (
          <SafetyModal
            alerts={safety.alerts}
            onProceed={() => {
              dismissed.current.add(step.step_number);
              setShowModal(false);
            }}
            onStop={async () => {
              try {
                const res = await fetch("/api/safety/escalate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    session_id: sessionId,
                    step_number: step.step_number,
                    alerts: safety.alerts,
                  }),
                });
                if (!res.ok) throw new Error(String(res.status));
                toast.success("Instructor alerted — stay where you are and wait for them.", { duration: 8000 });
              } catch {
                // Never leave the student thinking help is coming when it isn't.
                toast.error("Could not reach the instructor console — go and find your instructor directly.", { duration: 10000 });
              } finally {
                setShowModal(false);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
