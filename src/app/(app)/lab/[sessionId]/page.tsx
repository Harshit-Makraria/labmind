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
  const currentStep = session ? session.protocol.steps[session.currentStepIndex] : null;
  const stepNumber = currentStep?.step_number;

  // Server-side flag state (which steps became unreliable after a skip).
  const { data: detail } = useQuery({
    queryKey: ["session-detail", sessionId, stepNumber],
    queryFn: () => api.sessionDetail(sessionId),
    refetchInterval: 4000,
    enabled: !!session,
  });
  const flaggedSteps = new Set((detail?.steps ?? []).filter((s) => s.flagged).map((s) => s.step_number));

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

  if (!session) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 text-[var(--color-muted)]">
        <Loader2 className="animate-spin" />
        <p>Loading your lab session…</p>
        <button onClick={() => router.push("/library")} className="text-sm text-[var(--color-brand)] underline">
          Choose an experiment
        </button>
      </div>
    );
  }

  const steps = session.protocol.steps;
  const idx = session.currentStepIndex;
  const step = steps[idx];

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
            onStop={() => router.push("/library")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
