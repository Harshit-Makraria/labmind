"use client";

import { motion } from "framer-motion";
import { Camera, Check, ChevronDown, ChevronRight, FlaskConical, Link2Off, SkipForward } from "lucide-react";
import { useState } from "react";

import { ProgressBar } from "@/components/student/ProgressBar";
import { ReagentChips } from "@/components/student/ReagentChips";
import { SafetyBanner } from "@/components/student/SafetyBanner";
import { StepTimer } from "@/components/student/StepTimer";
import { Button } from "@/components/ui/button";
import type { ProtocolStep } from "@/lib/types";

interface StepCardProps {
  step: ProtocolStep;
  current: number;
  total: number;
  flagged?: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function StepCard({ step, current, total, flagged, onComplete, onSkip }: StepCardProps) {
  const [showWhy, setShowWhy] = useState(false);
  const requiresPhoto = step.vision_check_required;

  return (
    <motion.div
      key={step.step_number}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25 }}
    >
      <ProgressBar current={current} total={total} />

      <div className="card space-y-4 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-navy)] to-[var(--color-brand)] text-[2rem] font-bold leading-none text-white shadow">
            {step.step_number}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
              Step {current} of {total}
            </p>
            <h1 className="text-2xl font-bold text-[var(--color-navy)]">{step.title}</h1>
          </div>
        </div>

        {flagged && (
          <div className="flex items-start gap-2 rounded-[var(--radius-btn)] bg-[var(--color-warning)]/12 p-3 text-sm text-[var(--color-navy)]">
            <Link2Off size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <span>
              <span className="font-semibold">Results may be unreliable.</span> A prerequisite step was skipped — redo it
              before trusting this reading.
            </span>
          </div>
        )}

        <SafetyBanner flags={step.safety_flags} />

        <ul className="space-y-2">
          {step.instructions.map((ins, i) => (
            <li key={i} className="flex gap-2 text-[15px] leading-snug">
              <ChevronRight size={18} className="mt-0.5 shrink-0 text-[var(--color-brand)]" />
              <span>{ins}</span>
            </li>
          ))}
        </ul>

        <ReagentChips reagents={step.reagents} />

        <div className="flex flex-wrap items-center gap-3">
          {step.duration_seconds ? <StepTimer seconds={step.duration_seconds} /> : null}
          {step.expected_observation ? (
            <span className="flex items-center gap-1.5 text-sm text-[var(--color-muted)]">
              <FlaskConical size={15} /> Expect: {step.expected_observation}
            </span>
          ) : null}
        </div>

        {step.science_explanation ? (
          <div className="rounded-[var(--radius-btn)] bg-black/[0.03] p-3">
            <button
              onClick={() => setShowWhy((s) => !s)}
              className="flex w-full items-center justify-between text-sm font-semibold text-[var(--color-brand)]"
            >
              Why does this matter?
              <ChevronDown size={16} className={`transition-transform ${showWhy ? "rotate-180" : ""}`} />
            </button>
            {showWhy && <p className="mt-2 text-sm text-[var(--color-ink)]/80">{step.science_explanation}</p>}
          </div>
        ) : null}

        <Button onClick={onComplete}>
          {requiresPhoto ? (
            <>
              <Camera size={18} /> Capture Photo to Verify
            </>
          ) : (
            <>
              <Check size={18} /> Mark Step Complete
            </>
          )}
        </Button>

        <button
          onClick={onSkip}
          className="flex w-full items-center justify-center gap-1.5 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-warning)]"
        >
          <SkipForward size={13} /> Skip this step
        </button>
      </div>
    </motion.div>
  );
}
