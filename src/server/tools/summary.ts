import "server-only";
import type { Badge, LabReport, LearningSummary } from "@/lib/types";
import { getExperiment } from "@/server/experiments";
import { hydrateSession, type StoredSession } from "@/server/store/session-store";
import { analysePacing } from "@/server/tools/pacing";

const ALL_BADGES: Badge[] = [
  { id: "safe-hands",   label: "Safe Hands",        description: "Zero safety alerts",              icon: "🛡️", earned: false },
  { id: "sharp-eye",    label: "Sharp Eye",          description: "Vision verified on first attempt", icon: "👁️", earned: false },
  { id: "perfect-titre",label: "Perfect Titre",      description: "Result within 2% of expected",    icon: "🎯", earned: false },
  { id: "speed-chemist",label: "Speed Chemist",      description: "Completed every step at a genuine, unhurried pace", icon: "⚡", earned: false },
  { id: "no-skip",      label: "No Shortcuts",       description: "Completed every step",            icon: "✅", earned: false },
  { id: "first-try",    label: "First-Try Verify",   description: "All visions passed first try",    icon: "🥇", earned: false },
];

/**
 * The overview page tells students LabMind will compare their pre-lab
 * hypothesis to their actual result — this is that comparison. Extracts the
 * first number in the hypothesis's free text (e.g. "I think it'll be around
 * 0.1 mol/L") and checks it against what they actually measured, not just
 * the textbook theoretical value, so the verdict is about THEIR prediction
 * vs THEIR result.
 */
export function computeHypothesisVerdict(hypothesis: string | null, studentResult: number | null): string | null {
  if (!hypothesis) return null;
  if (studentResult === null) return null; // no result recorded yet to judge it against

  const match = hypothesis.match(/-?\d+(\.\d+)?/);
  if (!match) {
    const quoted = hypothesis.length > 60 ? `${hypothesis.slice(0, 57)}…` : hypothesis;
    return `You predicted "${quoted}" — no specific number to check against your measured result of ${studentResult}, but worth comparing now that you have it.`;
  }

  const predicted = Number.parseFloat(match[0]);
  if (predicted === 0) return null; // a "0" prediction makes % difference undefined/meaningless

  const diff = Math.round((Math.abs(predicted - studentResult) / Math.abs(predicted)) * 1000) / 10;
  if (diff <= 5) return `Nailed it — you predicted ${predicted} and measured ${studentResult} (${diff}% apart). Your reasoning before the experiment held up.`;
  if (diff <= 20) return `Close — you predicted ${predicted} and measured ${studentResult} (${diff}% apart). A reasonable estimate, worth refining next time.`;
  return `Off — you predicted ${predicted} but measured ${studentResult} (${diff}% apart). Revisit the theory behind this experiment before your next prediction.`;
}

export function computeSummary(sessionId: string, s: StoredSession | undefined): LearningSummary {
  if (!s) {
    return {
      session_id: sessionId, experiment_name: "Unknown", performance_score: 0,
      accuracy_score: 0, steps_completed: 0, steps_total: 0, skipped_steps: 0,
      safety_alerts: 0, overrides: 0, mistakes: [], concepts_learned: [],
      improvement_suggestions: [], badges: [], hypothesis: null, hypothesis_verdict: null,
    };
  }

  const completed = s.steps.filter((x) => x.state === "completed").length;
  const skipped   = s.steps.filter((x) => x.state === "skipped").length;
  const overrides = s.steps.filter((x) => x.manual_override).length;
  const maxVision = Math.max(0, ...s.steps.map((x) => x.vision_attempts));
  // Every step that actually went through a vision check, and whether EACH
  // ONE genuinely passed on its first attempt — not just "the attempt count
  // never exceeded 1" (true even for a single FAILED attempt that was then
  // manually overridden) and not "the last recordVision() call happened to
  // pass" (s.lastVisionPass is one mutable field overwritten by whichever
  // step's vision check ran most recently, not "every step passed").
  const visionSteps = s.steps.filter((x) => x.vision_attempts > 0);
  const allVisionFirstTryPass = visionSteps.length > 0 && visionSteps.every((x) => x.vision_attempts === 1 && x.vision_pass === true);

  // "Speed Chemist" used earned = completed === totalSteps — functionally
  // identical to "No Shortcuts" (skipped === 0) despite the name/icon
  // implying something about SPEED. Real per-step dwell-time data already
  // exists (analysePacing, wired into the Integrity page) but was never
  // consulted here — use its verdict so the badge actually requires a
  // genuine, un-gamed pace, not just "nothing skipped."
  const pacing = analysePacing(s.steps, getExperiment(s.experimentId).protocol, new Date(s.createdAt));

  const completionScore = Math.round((completed / (s.totalSteps || 1)) * 40);
  const accuracyRaw     = s.deviationPercent !== null ? Math.max(0, 100 - s.deviationPercent * 5) : 70;
  const safetyScore     = Math.max(0, 20 - s.safetyAlertCount * 5);
  const efficiencyScore = Math.max(0, 10 - skipped * 2 - overrides);
  const performance     = Math.min(100, completionScore + Math.round(accuracyRaw * 0.3) + safetyScore + efficiencyScore);

  const mistakes: string[] = [];
  if (s.safetyAlertCount > 0) mistakes.push(`${s.safetyAlertCount} safety alert(s) triggered`);
  if (skipped > 0)            mistakes.push(`${skipped} step(s) skipped`);
  if (overrides > 0)          mistakes.push(`${overrides} manual reading override(s)`);
  if (s.deviationPercent !== null && s.deviationPercent > 10)
    mistakes.push(`Result ${s.deviationPercent}% off — possible parallax or endpoint overshoot`);

  const concepts: string[] = [];
  if (s.experimentId === "acid-base-titration")
    concepts.push("Equivalence point detection", "Meniscus reading technique", "C = nV stoichiometry");
  else if (s.experimentId === "gel-electrophoresis")
    concepts.push("DNA migration in electric field", "Ladder-based size interpolation", "Agarose gel preparation");
  else if (s.experimentId === "iodine-clock")
    concepts.push("Reaction rate measurement (1/t)", "Temperature dependence of rate", "Iodine–starch colour indicator");

  const suggestions: string[] = [];
  if (s.deviationPercent !== null && s.deviationPercent > 5) suggestions.push("Practice meniscus reading at eye level");
  if (maxVision > 1) suggestions.push("Improve photo lighting for faster AI verification");
  if (skipped > 0)   suggestions.push("Complete all steps next trial for a valid result chain");
  if (suggestions.length === 0) suggestions.push("Excellent run! Try increasing the difficulty next time.");

  const badges: Badge[] = ALL_BADGES.map((b) => {
    let earned = false;
    if (b.id === "safe-hands")    earned = s.safetyAlertCount === 0;
    if (b.id === "perfect-titre") earned = s.deviationPercent !== null && s.deviationPercent <= 2;
    if (b.id === "speed-chemist") earned = completed === s.totalSteps && pacing.verdict === "consistent";
    if (b.id === "no-skip")       earned = skipped === 0;
    if (b.id === "first-try")     earned = allVisionFirstTryPass;
    if (b.id === "sharp-eye")     earned = allVisionFirstTryPass;
    return { ...b, earned };
  });

  return {
    session_id: sessionId,
    experiment_name: s.experimentName,
    performance_score: performance,
    accuracy_score: Math.round(accuracyRaw),
    steps_completed: completed,
    steps_total: s.totalSteps,
    skipped_steps: skipped,
    safety_alerts: s.safetyAlertCount,
    overrides,
    mistakes,
    concepts_learned: concepts,
    improvement_suggestions: suggestions,
    badges,
    hypothesis: s.hypothesis,
    hypothesis_verdict: computeHypothesisVerdict(s.hypothesis, s.studentResult),
  };
}

export async function buildLearningSummary(sessionId: string): Promise<LearningSummary> {
  const s = await hydrateSession(sessionId);
  return computeSummary(sessionId, s);
}

export async function buildReport(sessionId: string): Promise<LabReport> {
  const s = await hydrateSession(sessionId);
  const summary = computeSummary(sessionId, s);
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const observations = (s?.steps ?? [])
    .filter((x) => x.state === "completed")
    .map((x) => ({
      step: x.step_number,
      observation: x.vision_pass !== null ? (x.vision_pass ? "Verified ✓" : "Manual entry") : "Completed",
      reading: x.vision_reading ?? x.manual_override?.value,
    }));

  return {
    session_id: sessionId,
    student_name: s?.studentName ?? "Student",
    experiment_name: s?.experimentName ?? "Lab Experiment",
    date,
    aim: s?.experimentId === "acid-base-titration"
      ? "To determine the concentration of HCl by titration against standard NaOH."
      : s?.experimentId === "gel-electrophoresis"
      ? "To estimate the size of an unknown DNA fragment by gel electrophoresis."
      : s?.experimentId === "iodine-clock"
      ? "To measure the rate of the iodine clock reaction at room temperature."
      : s?.experimentId === "aur-experiment"
      ? "To measure the absorbance of a sample against a reference blank and relate it to concentration via the Beer-Lambert law."
      : `To complete the assigned experiment: ${s?.experimentName ?? "Lab Experiment"}.`,
    apparatus: s?.experimentId === "acid-base-titration"
      ? ["50 mL burette", "25 mL pipette", "Conical flask (250 mL)", "White tile", "Phenolphthalein indicator", "Retort stand and clamp"]
      : s?.experimentId === "gel-electrophoresis"
      ? ["Agarose gel (1%)", "TAE buffer", "Gel electrophoresis tank", "Power supply (100 V)", "DNA ladder", "Loading dye", "SYBR Safe stain"]
      : s?.experimentId === "aur-experiment"
      ? ["Spectrophotometer", "Cuvettes (matched pair)", "Reference blank solution", "Sample solution", "Lint-free tissue"]
      : ["Stopwatch", "250 mL beaker", "Measuring cylinders (10 mL, 50 mL)", "Solution A (KIO3)", "Solution B (Na2S2O3 + starch)"],
    procedure: (s?.steps ?? []).slice(0, 6).map((st) => `Step ${st.step_number}`),
    observations,
    calculations: s?.experimentId === "acid-base-titration"
      ? "C(HCl) = (M(NaOH) × V(titre)) / V(analyte) = (0.1 × titre_mL) / 25"
      : s?.experimentId === "iodine-clock"
      ? "Rate = 1/t (s⁻¹)"
      : s?.experimentId === "aur-experiment"
      ? "Beer-Lambert law: A = ε·c·l — absorbance is directly proportional to concentration."
      : "Size estimated by interpolation against ladder bands",
    result: s?.deviationPercent !== null
      ? `Result obtained with ${s!.deviationPercent}% deviation from expected value (${summary.accuracy_score}% accuracy).`
      : "Experiment in progress.",
    deviation_percent: s?.deviationPercent ?? null,
    mistakes: summary.mistakes,
    // s.notes accumulates real instructor/AI-escalation events (verification
    // approvals/rejections, safety escalations) via addInstructorNote() — this
    // was previously a hardcoded constant that could never reflect them.
    instructor_remarks: s?.notes.length ? s.notes.join(" · ") : "Pending instructor review.",
    performance_score: summary.performance_score,
  };
}
