/**
 * Deterministic physical validation of a vision reading.
 *
 * This layer contains no AI. It asks questions the model cannot answer for
 * itself: does this value exist on the instrument's scale, is it inside the
 * scale's range, and is it consistent with the student's own earlier readings?
 *
 * A vision model can hallucinate a plausible-looking number. It cannot make
 * that number divisible by the graduation interval, inside the burette's
 * physical range, AND consistent with the reading the same student recorded ten
 * minutes ago. That is what this file checks.
 */
import "server-only";
import type { StepRecord, VisionCheckType } from "@/lib/types";
import { instrumentFor } from "@/server/tools/instrument-spec";

export type ViolationCode =
  | "off_scale"
  | "impossible_granularity"
  | "non_monotonic"
  | "implausible_delta"
  | "discordant_replicate";

export interface Violation {
  code: ViolationCode;
  /** Shown to the student. */
  message: string;
  /** hard = the reading cannot be true; soft = suspicious, needs a human. */
  severity: "hard" | "soft";
}

export interface ConstraintResult {
  violations: Violation[];
  /** Reading snapped to the nearest real graduation, when snapping is safe. */
  snappedReading: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validate a reading against instrument physics and session history.
 *
 * @param priorSteps  step records already recorded for this session
 * @param stepNumber  the step being verified now
 */
export function checkPhysicalConstraints(
  reading: number | null,
  type: VisionCheckType,
  priorSteps: StepRecord[],
  stepNumber: number,
): ConstraintResult {
  const spec = instrumentFor(type);
  if (reading === null || !spec) return { violations: [], snappedReading: reading };

  const violations: Violation[] = [];

  // ── 1. Range ────────────────────────────────────────────────────────
  // A 50 mL burette cannot read 87 mL. No confidence score makes that true.
  if (reading < spec.min || reading > spec.max) {
    violations.push({
      code: "off_scale",
      severity: "hard",
      message: `${reading} ${spec.unit} is outside the instrument's range (${spec.min}–${spec.max} ${spec.unit}).`,
    });
    return { violations, snappedReading: null };
  }

  // ── 2. Granularity ──────────────────────────────────────────────────
  // Burettes are graduated every 0.1 mL and read to 0.05. A value like 24.37
  // corresponds to no physical mark, so the model interpolated or invented it.
  const steps = reading / spec.granularity;
  const snapped = round2(Math.round(steps) * spec.granularity);
  const offBy = Math.abs(reading - snapped);
  if (offBy > spec.granularity * 0.2) {
    violations.push({
      code: "impossible_granularity",
      severity: "soft",
      message: `${reading} ${spec.unit} falls between graduations — this instrument reads in steps of ${spec.granularity} ${spec.unit}. Recorded as ${snapped}.`,
    });
  }

  // ── 3. Continuity against the student's own earlier readings ────────
  // Burette volume only ever increases during a titration: liquid leaves the
  // burette, so the final reading must exceed the initial one.
  if (spec.plausibleDelta) {
    const earlier = priorSteps
      .filter((s) => s.step_number < stepNumber && s.vision_reading !== null)
      .sort((a, b) => a.step_number - b.step_number);
    const initial = earlier[0];

    if (initial?.vision_reading !== null && initial !== undefined) {
      const start = initial.vision_reading as number;
      const delta = round2(snapped - start);

      if (delta < 0) {
        violations.push({
          code: "non_monotonic",
          severity: "hard",
          message: `Final reading (${snapped}) is below the initial reading (${start}). Liquid cannot flow back into the burette — one of the two readings is wrong.`,
        });
      } else if (delta < spec.plausibleDelta.min || delta > spec.plausibleDelta.max) {
        violations.push({
          code: "implausible_delta",
          severity: "soft",
          message: `A titre of ${delta} ${spec.unit} (${start} → ${snapped}) is outside the plausible range of ${spec.plausibleDelta.min}–${spec.plausibleDelta.max} ${spec.unit}.`,
        });
      }
    }
  }

  // ── 4. Replicate concordance ────────────────────────────────────────
  // Titrations are run in triplicate; concordant titres agree within 0.1 mL.
  // Scattered replicates mean a technique problem the vision check can't see.
  if (spec.concordance) {
    const replicates = priorSteps
      .filter((s) => s.step_number !== stepNumber && s.vision_reading !== null)
      .map((s) => s.vision_reading as number);
    if (replicates.length >= 2) {
      const all = [...replicates, snapped];
      const spread = round2(Math.max(...all) - Math.min(...all));
      if (spread > spec.concordance * 3) {
        violations.push({
          code: "discordant_replicate",
          severity: "soft",
          message: `Your readings across runs differ by ${spread} ${spec.unit}. Concordant titres should agree within ${spec.concordance} ${spec.unit}.`,
        });
      }
    }
  }

  return { violations, snappedReading: snapped };
}

export function hasHardViolation(v: Violation[]): boolean {
  return v.some((x) => x.severity === "hard");
}
