import "server-only";
import type { Badge, LabReport, LearningSummary } from "@/lib/types";
import { hydrateSession, type StoredSession } from "@/server/store/session-store";

const ALL_BADGES: Badge[] = [
  { id: "safe-hands",   label: "Safe Hands",        description: "Zero safety alerts",              icon: "🛡️", earned: false },
  { id: "sharp-eye",    label: "Sharp Eye",          description: "Vision verified on first attempt", icon: "👁️", earned: false },
  { id: "perfect-titre",label: "Perfect Titre",      description: "Result within 2% of expected",    icon: "🎯", earned: false },
  { id: "speed-chemist",label: "Speed Chemist",      description: "Completed all steps",             icon: "⚡", earned: false },
  { id: "no-skip",      label: "No Shortcuts",       description: "Completed every step",            icon: "✅", earned: false },
  { id: "first-try",    label: "First-Try Verify",   description: "All visions passed first try",    icon: "🥇", earned: false },
];

function computeSummary(sessionId: string, s: StoredSession | undefined): LearningSummary {
  if (!s) {
    return {
      session_id: sessionId, experiment_name: "Unknown", performance_score: 0,
      accuracy_score: 0, steps_completed: 0, steps_total: 0, skipped_steps: 0,
      safety_alerts: 0, overrides: 0, mistakes: [], concepts_learned: [],
      improvement_suggestions: [], badges: [],
    };
  }

  const completed = s.steps.filter((x) => x.state === "completed").length;
  const skipped   = s.steps.filter((x) => x.state === "skipped").length;
  const overrides = s.steps.filter((x) => x.manual_override).length;
  const maxVision = Math.max(0, ...s.steps.map((x) => x.vision_attempts));

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
    if (b.id === "speed-chemist") earned = completed === s.totalSteps;
    if (b.id === "no-skip")       earned = skipped === 0;
    if (b.id === "first-try")     earned = maxVision <= 1;
    if (b.id === "sharp-eye")     earned = s.lastVisionPass === true && maxVision <= 1;
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
      : "To measure the rate of the iodine clock reaction at room temperature.",
    apparatus: s?.experimentId === "acid-base-titration"
      ? ["50 mL burette", "25 mL pipette", "Conical flask (250 mL)", "White tile", "Phenolphthalein indicator", "Retort stand and clamp"]
      : s?.experimentId === "gel-electrophoresis"
      ? ["Agarose gel (1%)", "TAE buffer", "Gel electrophoresis tank", "Power supply (100 V)", "DNA ladder", "Loading dye", "SYBR Safe stain"]
      : ["Stopwatch", "250 mL beaker", "Measuring cylinders (10 mL, 50 mL)", "Solution A (KIO3)", "Solution B (Na2S2O3 + starch)"],
    procedure: (s?.steps ?? []).slice(0, 6).map((st) => `Step ${st.step_number}`),
    observations,
    calculations: s?.experimentId === "acid-base-titration"
      ? "C(HCl) = (M(NaOH) × V(titre)) / V(analyte) = (0.1 × titre_mL) / 25"
      : s?.experimentId === "iodine-clock"
      ? "Rate = 1/t (s⁻¹)"
      : "Size estimated by interpolation against ladder bands",
    result: s?.deviationPercent !== null
      ? `Result obtained with ${s!.deviationPercent}% deviation from expected value (${summary.accuracy_score}% accuracy).`
      : "Experiment in progress.",
    deviation_percent: s?.deviationPercent ?? null,
    mistakes: summary.mistakes,
    instructor_remarks: "Pending instructor review.",
    performance_score: summary.performance_score,
  };
}
