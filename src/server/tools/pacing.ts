/**
 * Pacing / dwell-time analysis.
 *
 * Every step completion already records a `completed_at` timestamp — the store
 * has been writing them since day one and nothing ever read them. Together they
 * form a complete timestamped trace of how the student actually worked.
 *
 * This catches a fraud mode nothing else in the system can see. A student who
 * photographs a classmate's apparatus produces perfectly valid images, and the
 * vision pipeline will pass them. What they cannot fake is the clock: a
 * titration to endpoint cannot be performed in forty seconds. Physical
 * processes take physical time.
 *
 * Deliberately conservative. A false accusation of cheating is far more costly
 * than a missed one, so this only flags durations that are physically
 * impossible, and always phrases findings as evidence for the instructor rather
 * than as a verdict.
 */
import "server-only";
import type { Protocol, StepRecord } from "@/lib/types";

export type PacingFlag = "impossibly_fast" | "no_dwell" | "suspicious_uniformity";

export interface StepPacing {
  step_number: number;
  title: string;
  /** Seconds spent on this step. null when it can't be derived. */
  elapsed_seconds: number | null;
  /** Protocol's stated duration, when the step declares one. */
  expected_seconds: number | null;
  flag: PacingFlag | null;
  reason: string | null;
}

export interface PacingReport {
  steps: StepPacing[];
  total_seconds: number | null;
  expected_total_seconds: number;
  flagged_count: number;
  /**
   * 0–100, or null when there is not yet enough evidence to score.
   * Absence of data is not evidence of good practice — a session with no
   * completed steps must not present as a perfect 100.
   */
  integrity_score: number | null;
  verdict: "no_data" | "consistent" | "review_recommended" | "implausible";
  summary: string;
}

/**
 * A step declaring N seconds cannot credibly be done in less than this fraction
 * of N. Set low so only egregious cases trip: a 5-minute titration flagged only
 * under ~1 minute.
 */
const MIN_FRACTION_OF_STATED = 0.2;

/** Any step completed faster than this was almost certainly just a tap-through. */
const ABSOLUTE_FLOOR_SECONDS = 5;

/** Steps that genuinely involve waiting/observing get a hard minimum. */
const OBSERVATION_FLOOR_SECONDS = 20;

function isObservationStep(title: string, hasVisionCheck: boolean): boolean {
  const t = title.toLowerCase();
  return hasVisionCheck || /titrat|endpoint|observ|wait|incubat|run|electrophor|react|heat|cool|mix|swirl/.test(t);
}

export function analysePacing(
  steps: StepRecord[],
  protocol: Protocol,
  sessionStart: Date,
): PacingReport {
  const completed = steps
    .filter((s) => s.completed_at)
    .sort((a, b) => a.step_number - b.step_number);

  const expectedTotal = protocol.steps.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);

  const out: StepPacing[] = [];
  let prev = sessionStart.getTime();

  for (const rec of completed) {
    const def = protocol.steps.find((s) => s.step_number === rec.step_number);
    const at = new Date(rec.completed_at as string).getTime();
    const elapsed = Number.isFinite(at) ? Math.max(0, Math.round((at - prev) / 1000)) : null;
    prev = Number.isFinite(at) ? at : prev;

    const expected = def?.duration_seconds ?? null;
    const title = def?.title ?? `Step ${rec.step_number}`;

    let flag: PacingFlag | null = null;
    let reason: string | null = null;

    if (elapsed !== null) {
      const needsDwell = isObservationStep(title, !!def?.vision_check_required);

      if (elapsed < ABSOLUTE_FLOOR_SECONDS) {
        flag = "no_dwell";
        reason = `Completed in ${elapsed}s — too fast to have performed the step.`;
      } else if (expected !== null && elapsed < expected * MIN_FRACTION_OF_STATED) {
        flag = "impossibly_fast";
        reason = `Completed in ${fmt(elapsed)} against a stated ${fmt(expected)} — under ${Math.round(MIN_FRACTION_OF_STATED * 100)}% of the protocol's own timing.`;
      } else if (needsDwell && elapsed < OBSERVATION_FLOOR_SECONDS) {
        flag = "impossibly_fast";
        reason = `"${title}" requires observation but was completed in ${elapsed}s.`;
      }
    }

    out.push({ step_number: rec.step_number, title, elapsed_seconds: elapsed, expected_seconds: expected, flag, reason });
  }

  // Near-identical gaps across many steps indicate scripted clicking rather
  // than hands-on work, which no single-step threshold would catch.
  const gaps = out.map((s) => s.elapsed_seconds).filter((n): n is number => n !== null);
  if (gaps.length >= 4) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    if (mean > 0 && sd / mean < 0.15 && mean < 60) {
      for (const s of out) {
        if (!s.flag) {
          s.flag = "suspicious_uniformity";
          s.reason = `Every step took almost exactly ${Math.round(mean)}s — real lab work varies in pace.`;
        }
      }
    }
  }

  const flagged = out.filter((s) => s.flag).length;
  const total = out.length ? gaps.reduce((a, b) => a + b, 0) : null;

  // A session with nothing completed carries no evidence either way. Scoring it
  // 100 would present an unstarted experiment as verified good practice, so
  // withhold the score until there is something to judge.
  if (out.length === 0) {
    return {
      steps: out,
      total_seconds: null,
      expected_total_seconds: expectedTotal,
      flagged_count: 0,
      integrity_score: null,
      verdict: "no_data",
      summary: "No steps completed yet — timing integrity will be assessed as the student works.",
    };
  }

  // Score falls with the SHARE of steps flagged, not the raw count, so a long
  // experiment isn't penalised for one anomaly.
  const ratio = flagged / out.length;
  const integrity = Math.max(0, Math.round((1 - ratio) * 100));

  const verdict: PacingReport["verdict"] =
    ratio === 0 ? "consistent" : ratio < 0.34 ? "review_recommended" : "implausible";

  const summary =
    verdict === "consistent"
      ? `Pacing is consistent with genuine lab work across ${out.length} completed step${out.length === 1 ? "" : "s"}.`
      : verdict === "review_recommended"
        ? `${flagged} of ${out.length} steps completed unusually quickly — worth a look.`
        : `${flagged} of ${out.length} steps completed faster than physically possible. This session likely was not performed as recorded.`;

  return {
    steps: out,
    total_seconds: total,
    expected_total_seconds: expectedTotal,
    flagged_count: flagged,
    integrity_score: integrity,
    verdict,
    summary,
  };
}

function fmt(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}
