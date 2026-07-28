/**
 * Risk scoring and adaptive verification thresholds.
 *
 * The core constraint LabMind exists to address is that one instructor cannot
 * watch forty students. Treating every student identically wastes that scarce
 * attention: a student with a clean record and concordant replicates is checked
 * as hard as one who has already triggered a safety alert and two overrides.
 *
 * This module makes supervision adaptive. It scores each session from signals
 * already recorded, then raises or lowers the auto-verification bar for that
 * student. Low-risk students pass through with less friction; high-risk ones
 * get more of the instructor's time. The instructor's attention is allocated
 * where the risk actually is.
 *
 * Framing matters: this ranks who to walk over to next. It is not a punishment,
 * and every factor is shown explicitly so the instructor can disagree with it.
 */
import "server-only";
import { VISION_HIGH_CONFIDENCE } from "@/lib/types";
import type { StepRecord } from "@/lib/types";

export interface RiskFactor {
  code: string;
  label: string;
  /** Points contributed. Positive raises risk. */
  weight: number;
}

export interface RiskAssessment {
  session_id: string;
  student_name: string;
  /** 0–100. Higher = needs attention sooner. */
  score: number;
  band: "low" | "moderate" | "elevated" | "high";
  factors: RiskFactor[];
  /** Confidence the vision pipeline must reach to auto-verify THIS student. */
  verification_threshold: number;
  recommendation: string;
}

/** Threshold moves within this band — never below the floor, never above the ceiling. */
const THRESHOLD_FLOOR = 0.78;
const THRESHOLD_CEILING = 0.94;

export function assessRisk(input: {
  sessionId: string;
  studentName: string;
  steps: StepRecord[];
  safetyAlertCount: number;
  deviationPercent: number | null;
  prelabPassed: boolean | null;
  pacingFlagged: number;
}): RiskAssessment {
  const factors: RiskFactor[] = [];
  const { steps, safetyAlertCount, deviationPercent, prelabPassed, pacingFlagged } = input;

  if (safetyAlertCount > 0) {
    factors.push({
      code: "safety_alerts",
      label: `${safetyAlertCount} safety alert${safetyAlertCount === 1 ? "" : "s"} raised`,
      weight: Math.min(35, safetyAlertCount * 18),
    });
  }

  const overrides = steps.filter((s) => s.manual_override).length;
  if (overrides > 0) {
    factors.push({
      code: "manual_overrides",
      label: `${overrides} manual override${overrides === 1 ? "" : "s"} — values typed, not verified`,
      weight: Math.min(25, overrides * 12),
    });
  }

  const skipped = steps.filter((s) => s.state === "skipped").length;
  if (skipped > 0) {
    factors.push({ code: "skipped_steps", label: `${skipped} step${skipped === 1 ? "" : "s"} skipped`, weight: Math.min(20, skipped * 10) });
  }

  const flagged = steps.filter((s) => s.flagged).length;
  if (flagged > 0) {
    factors.push({ code: "flagged_steps", label: `${flagged} step${flagged === 1 ? "" : "s"} unreliable from an earlier skip`, weight: Math.min(15, flagged * 5) });
  }

  const retries = steps.filter((s) => s.vision_attempts > 2).length;
  if (retries > 0) {
    factors.push({ code: "vision_retries", label: `${retries} step${retries === 1 ? "" : "s"} needed 3+ photo attempts`, weight: Math.min(15, retries * 7) });
  }

  if (pacingFlagged > 0) {
    factors.push({ code: "pacing", label: `${pacingFlagged} step${pacingFlagged === 1 ? "" : "s"} completed implausibly fast`, weight: Math.min(30, pacingFlagged * 12) });
  }

  if (prelabPassed === false) {
    factors.push({ code: "prelab_failed", label: "Failed the pre-lab readiness quiz", weight: 15 });
  }

  if (deviationPercent !== null && deviationPercent > 10) {
    factors.push({ code: "high_deviation", label: `Result ${deviationPercent}% from expected`, weight: 12 });
  }

  // Positive signal — a clean run should actively lower friction, not merely
  // avoid raising it.
  const completed = steps.filter((s) => s.state === "completed").length;
  if (completed >= 3 && factors.length === 0) {
    factors.push({ code: "clean_run", label: `${completed} steps completed cleanly, no interventions`, weight: -10 });
  }

  const raw = factors.reduce((sum, f) => sum + f.weight, 0);
  const score = Math.max(0, Math.min(100, raw));

  const band: RiskAssessment["band"] =
    score >= 60 ? "high" : score >= 35 ? "elevated" : score >= 15 ? "moderate" : "low";

  // Map score onto the confidence bar this student must clear to auto-verify.
  const span = THRESHOLD_CEILING - THRESHOLD_FLOOR;
  const threshold = Math.round((THRESHOLD_FLOOR + (score / 100) * span) * 100) / 100;

  const recommendation =
    band === "high"
      ? "Check on this student directly — several independent signals are elevated."
      : band === "elevated"
        ? "Review their next submission carefully before approving."
        : band === "moderate"
          ? "Nothing urgent; keep an eye on the queue."
          : "On track — no intervention needed.";

  return {
    session_id: input.sessionId,
    student_name: input.studentName,
    score,
    band,
    factors: factors.sort((a, b) => b.weight - a.weight),
    verification_threshold: threshold,
    recommendation,
  };
}

/** Default bar when no per-student assessment is available. */
export const DEFAULT_THRESHOLD = VISION_HIGH_CONFIDENCE;
