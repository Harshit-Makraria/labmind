/**
 * Expected-result resolution and grading, for every kind of lab.
 *
 * Two problems this fixes.
 *
 * 1. CORRECTNESS. `Protocol` (an AI-parsed or manually built experiment) had no
 *    expected result of its own, so /results/interpret graded every custom
 *    experiment against `getExperiment(id).theoretical` — the LIBRARY value for
 *    whatever experiment the session happened to be filed under. An instructor
 *    who uploaded a redox-titration PDF had their students graded against
 *    acid-base titration's 0.1 mol/L. Every deviation figure, accuracy score
 *    and report number for a custom experiment was wrong.
 *
 * 2. UNIVERSALITY. Grading assumed every experiment ends in a float. Most labs
 *    don't: microscopy ends in a category, a circuit test in a yes/no, a
 *    programming lab in a description. Those couldn't be graded at all, which
 *    is why the product only worked for chemistry-style measurements.
 *
 * The library experiments are unchanged — resolveExpectedResult() bridges their
 * existing `theoretical` field into the same shape, so one grader serves both.
 */
import "server-only";
import type { Experiment, ExpectedResult, Protocol, ResultKind } from "@/lib/types";

/**
 * Work out what THIS session should actually be graded against.
 *
 * Order matters: the protocol's own expected result wins when present, because
 * that is the instructor's actual experiment. The library experiment is only a
 * fallback for the built-in protocols, which legitimately carry their target on
 * `Experiment.theoretical`.
 */
export function resolveExpectedResult(
  protocol: Protocol | null | undefined,
  experiment: Experiment,
): ExpectedResult {
  const own = protocol?.expected_result;
  if (own && isUsable(own)) return normalise(own);

  // Library experiments (and any custom protocol that didn't declare one) fall
  // back to the classic numeric target.
  return {
    kind: "numeric",
    label: experiment.theoretical.label,
    value: experiment.theoretical.value,
    unit: experiment.theoretical.unit,
    tolerance: null,
  };
}

/**
 * A declared expected result is only usable if it actually carries the data its
 * own kind requires. A parser that emits `{kind:"numeric"}` with no value would
 * otherwise produce a division-by-zero deviation and grade everyone at 0%.
 */
function isUsable(r: ExpectedResult): boolean {
  switch (r.kind) {
    case "numeric":
      return typeof r.value === "number" && Number.isFinite(r.value);
    case "categorical":
      return Array.isArray(r.options) && r.options.length > 0 && r.correct != null;
    case "boolean":
      return typeof r.correct === "boolean";
    case "qualitative":
      return typeof r.rubric === "string" && r.rubric.trim().length > 0;
    case "none":
      return true;
    default:
      return false;
  }
}

function normalise(r: ExpectedResult): ExpectedResult {
  return {
    ...r,
    label: r.label?.trim() || "Result",
    unit: r.unit ?? null,
    tolerance: typeof r.tolerance === "number" && r.tolerance > 0 ? r.tolerance : null,
  };
}

// ─── Grading ────────────────────────────────────────────────────────

export interface GradeOutcome {
  kind: ResultKind;
  /** Numeric only. */
  deviationPercent: number | null;
  /** Non-numeric only. */
  correct: boolean | null;
  /** Human-readable statement of what was compared, for the trace/report. */
  comparison: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Case/whitespace-insensitive match, so "Cardiac Muscle" matches "cardiac muscle". */
const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function gradeResult(
  expected: ExpectedResult,
  submitted: { numeric?: number | null; answer?: string | boolean | null },
): GradeOutcome {
  switch (expected.kind) {
    case "numeric": {
      const theo = expected.value ?? 0;
      const measured = submitted.numeric;
      if (typeof measured !== "number" || !Number.isFinite(measured)) {
        return { kind: "numeric", deviationPercent: null, correct: null, comparison: "No numeric result submitted." };
      }
      // Guard against a zero target — percent deviation is undefined there, and
      // silently reporting 0% would read as a perfect score.
      const deviation = theo !== 0 ? round1((Math.abs(measured - theo) / Math.abs(theo)) * 100) : 0;
      const unit = expected.unit ? ` ${expected.unit}` : "";
      return {
        kind: "numeric",
        deviationPercent: deviation,
        correct: expected.tolerance != null ? Math.abs(measured - theo) <= expected.tolerance : null,
        comparison: `${measured}${unit} vs. expected ${theo}${unit}`,
      };
    }

    case "categorical": {
      const answer = typeof submitted.answer === "string" ? submitted.answer : "";
      const key = expected.correct;
      const accepted = Array.isArray(key) ? key : typeof key === "string" ? [key] : [];
      const correct = accepted.some((k) => canon(k) === canon(answer));
      return {
        kind: "categorical",
        deviationPercent: null,
        correct,
        comparison: `Selected "${answer || "—"}" · expected "${accepted.join('" or "')}"`,
      };
    }

    case "boolean": {
      const answer =
        typeof submitted.answer === "boolean"
          ? submitted.answer
          : typeof submitted.answer === "string"
            ? /^(yes|true|1|pass)$/i.test(submitted.answer.trim())
            : null;
      if (answer === null) {
        return { kind: "boolean", deviationPercent: null, correct: null, comparison: "No answer submitted." };
      }
      const correct = answer === expected.correct;
      return {
        kind: "boolean",
        deviationPercent: null,
        correct,
        comparison: `Answered ${answer ? "yes" : "no"} · expected ${expected.correct ? "yes" : "no"}`,
      };
    }

    case "qualitative": {
      // Deliberately NOT auto-graded here. A free-text observation needs either
      // an LLM judge against the rubric or an instructor's eye; asserting a
      // pass/fail from a keyword match would be a confident wrong answer, which
      // is worse than an honest "needs review".
      const answer = typeof submitted.answer === "string" ? submitted.answer.trim() : "";
      return {
        kind: "qualitative",
        deviationPercent: null,
        correct: null,
        comparison: answer ? `Recorded ${answer.length} characters for instructor review.` : "No observation recorded.",
      };
    }

    case "none":
    default:
      return { kind: "none", deviationPercent: null, correct: null, comparison: "This experiment records no final result." };
  }
}
