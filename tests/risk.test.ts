import { describe, expect, it } from "vitest";

import { assessRisk } from "@/server/tools/risk";
import type { StepRecord } from "@/lib/types";

function blankStep(n: number, overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    step_number: n,
    state: "pending",
    flagged: false,
    vision_attempts: 0,
    vision_reading: null,
    vision_pass: null,
    manual_override: null,
    completed_at: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof assessRisk>[0]> = {}) {
  return {
    sessionId: "t",
    studentName: "Test Student",
    steps: [] as StepRecord[],
    safetyAlertCount: 0,
    deviationPercent: null,
    prelabPassed: null,
    pacingFlagged: 0,
    ...overrides,
  };
}

describe("assessRisk", () => {
  it("gives a clean run a threshold BELOW a brand-new zero-data session, not the same one", () => {
    // This is the exact regression the code comment warns about: using the
    // clamped `score` instead of raw `raw` for the threshold calc would make
    // a clean run and a zero-data session land on the identical threshold
    // (both clamp to score=0), silently erasing the "lower friction" bonus.
    const completedSteps = [1, 2, 3].map((n) => blankStep(n, { state: "completed" }));
    const cleanRun = assessRisk(baseInput({ steps: completedSteps }));
    const zeroData = assessRisk(baseInput({ steps: [] }));

    expect(cleanRun.factors.map((f) => f.code)).toContain("clean_run");
    expect(cleanRun.verification_threshold).toBeLessThan(zeroData.verification_threshold);
  });

  it("bands score at the documented boundaries (>= comparisons)", () => {
    // safety_alerts weight = min(35, count*18); 1 alert -> 18 -> "moderate" (>=15)
    const moderate = assessRisk(baseInput({ safetyAlertCount: 1 }));
    expect(moderate.score).toBe(18);
    expect(moderate.band).toBe("moderate");

    // 2 alerts -> min(35, 2*18=36) = 35 -> "elevated" (>=35)
    const elevated = assessRisk(baseInput({ safetyAlertCount: 2 }));
    expect(elevated.score).toBe(35);
    expect(elevated.band).toBe("elevated");

    // safety(min(35,4*18)=35) + overrides(min(25,2*12)=24) = 59 -> still "elevated"
    const stillElevated = assessRisk(
      baseInput({
        safetyAlertCount: 4,
        steps: [1, 2].map((n) => blankStep(n, { manual_override: { value: 1, note: "x" } })),
      }),
    );
    expect(stillElevated.score).toBe(59);
    expect(stillElevated.band).toBe("elevated");

    // safety(35) + overrides(min(25,3*12)=25) = 60 -> "high" (>=60)
    const high = assessRisk(
      baseInput({
        safetyAlertCount: 4,
        steps: [1, 2, 3].map((n) => blankStep(n, { manual_override: { value: 1, note: "x" } })),
      }),
    );
    expect(high.score).toBe(60);
    expect(high.band).toBe("high");
  });

  it("clamps score at 100 for display but the threshold formula uses raw beyond 100", () => {
    // Stack every factor to blow well past 100 raw points.
    const input = baseInput({
      safetyAlertCount: 5, // -> 35 (capped)
      pacingFlagged: 5, // -> 30 (capped)
      duplicatePhotoCount: 3, // -> 40 (capped)
      prelabPassed: false, // -> 15
      deviationPercent: 20, // -> 12
    });
    const result = assessRisk(input);
    const raw = 35 + 30 + 40 + 15 + 12; // 132

    expect(result.score).toBe(100); // clamped for display/banding
    expect(result.band).toBe("high");
    // threshold formula is FLOOR + (raw/100)*span, NOT (score/100)*span — so it
    // can exceed the documented ceiling when raw > 100. Asserting the real
    // (uncapped) value pins current behavior so a future clamp-fix is a
    // deliberate, visible change rather than a silent one.
    const span = 0.94 - 0.78;
    const expectedThreshold = Math.round((0.78 + (raw / 100) * span) * 100) / 100;
    expect(result.verification_threshold).toBe(expectedThreshold);
    expect(result.verification_threshold).toBeGreaterThan(0.94);
  });

  it("duplicate photos alone are scored and labelled, not silently dropped", () => {
    const result = assessRisk(baseInput({ duplicatePhotoCount: 2 }));
    const factor = result.factors.find((f) => f.code === "duplicate_photo");
    expect(factor).toBeDefined();
    expect(factor?.weight).toBe(40); // min(40, 2*25)
    expect(factor?.label).toContain("2 duplicate photos");
    expect(result.score).toBe(40);
    expect(result.band).toBe("elevated"); // 40 is >=35 (elevated) and <60 (high)
  });
});
