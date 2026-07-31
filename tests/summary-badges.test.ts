import { describe, expect, it } from "vitest";

import { computeSummary } from "@/server/tools/summary";
import type { StoredSession } from "@/server/store/session-store";
import type { StepRecord } from "@/lib/types";

function blankStep(n: number): StepRecord {
  return {
    step_number: n,
    state: "pending",
    flagged: false,
    vision_attempts: 0,
    vision_reading: null,
    vision_pass: null,
    manual_override: null,
    completed_at: null,
  };
}

function baseSession(steps: StepRecord[]): StoredSession {
  return {
    sessionId: "t",
    studentName: "Test Student",
    experimentId: "aur-experiment", // 3-step protocol, simplest fixture
    experimentName: "AUR — Absorbance Using a Reference",
    currentStep: steps.length,
    totalSteps: 3,
    status: "active",
    reagentHistory: [],
    lastVisionPass: null,
    deviationPercent: null,
    studentResult: null,
    safetyAlertCount: 0,
    duplicatePhotoCount: 0,
    steps,
    safetyLog: [],
    notes: [],
    hypothesis: null,
    createdAt: Date.now() - 10 * 60_000,
    updatedAt: Date.now(),
  };
}

function badge(summary: ReturnType<typeof computeSummary>, id: string) {
  return summary.badges.find((b) => b.id === id)!;
}

describe("summary badges reflect what they claim, not just attempt counts", () => {
  it("First-Try Verify / Sharp Eye are NOT earned when a vision step failed and was manually overridden", () => {
    const steps = [1, 2, 3].map(blankStep);
    // Step 3 (the only vision-required step in AUR): one failed attempt, then a manual override.
    steps[2] = { ...steps[2], state: "completed", vision_attempts: 1, vision_pass: false, manual_override: { value: 0.11, note: "override" } };
    const summary = computeSummary("t", baseSession(steps));
    expect(badge(summary, "first-try").earned).toBe(false);
    expect(badge(summary, "sharp-eye").earned).toBe(false);
  });

  it("First-Try Verify / Sharp Eye are NOT earned when an earlier vision step failed even if a later one passes on its first try", () => {
    // Reproduces the exact bug: lastVisionPass reflects only the LAST recordVision()
    // call, so an early failure followed by a later first-try pass used to flip it
    // to true and award the badge despite one step never truly passing.
    const steps = [1, 2, 3].map(blankStep);
    steps[0] = { ...steps[0], state: "completed", vision_attempts: 1, vision_pass: false, manual_override: { value: 0.2, note: "override" } };
    steps[2] = { ...steps[2], state: "completed", vision_attempts: 1, vision_pass: true };
    const summary = computeSummary("t", baseSession(steps));
    expect(badge(summary, "first-try").earned).toBe(false);
    expect(badge(summary, "sharp-eye").earned).toBe(false);
  });

  it("First-Try Verify / Sharp Eye ARE earned when every vision-attempted step passed on its first try", () => {
    const steps = [1, 2, 3].map(blankStep);
    steps[2] = { ...steps[2], state: "completed", vision_attempts: 1, vision_pass: true };
    const summary = computeSummary("t", baseSession(steps));
    expect(badge(summary, "first-try").earned).toBe(true);
    expect(badge(summary, "sharp-eye").earned).toBe(true);
  });

  it("Speed Chemist requires all steps completed AND a genuine (non-suspicious) pace, not just 'nothing skipped'", () => {
    const now = Date.now();
    const steps: StepRecord[] = [1, 2, 3].map((n) => ({
      ...blankStep(n),
      state: "completed",
      // Spaced comfortably past every pacing floor for AUR's declared durations
      // (120s/60s/60s) and non-uniform, so this reads as genuine, unhurried work.
      completed_at: new Date(now - (3 - n) * 90_000).toISOString(),
    }));
    const session = baseSession(steps);
    session.createdAt = now - 5 * 60_000;
    const summary = computeSummary("t", session);
    expect(badge(summary, "speed-chemist").earned).toBe(true);
  });

  it("Speed Chemist is NOT earned when steps were completed implausibly fast (the exact gaming case the old logic missed)", () => {
    const now = Date.now();
    const steps: StepRecord[] = [1, 2, 3].map((n) => ({
      ...blankStep(n),
      state: "completed",
      // 1 second apart — far faster than physically possible for this protocol.
      completed_at: new Date(now - (3 - n) * 1000).toISOString(),
    }));
    const session = baseSession(steps);
    session.createdAt = now - 4000;
    const summary = computeSummary("t", session);
    expect(badge(summary, "speed-chemist").earned).toBe(false);
  });
});
