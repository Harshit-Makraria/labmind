import { describe, expect, it } from "vitest";

import { checkPhysicalConstraints } from "@/server/tools/physical-constraints";
import type { StepRecord } from "@/lib/types";

function stepRecord(step_number: number, vision_reading: number | null): StepRecord {
  return {
    step_number,
    state: "completed",
    flagged: false,
    vision_attempts: 1,
    vision_reading,
    vision_pass: true,
    manual_override: null,
    completed_at: new Date().toISOString(),
  };
}

describe("checkPhysicalConstraints — replicate concordance", () => {
  it("does NOT flag a clean titration: initial readings (~0 mL) must not be pooled against the final reading (~24.5 mL)", () => {
    // Titration protocol: step 1 = prepare burette (expected 0.0), step 3 = initial
    // reading (expected 0.0), step 5 = final reading (expected 24.5) — checking step 5.
    const priorSteps = [stepRecord(1, 0.02), stepRecord(3, 0.0)];
    const result = checkPhysicalConstraints(24.55, "burette_reading", priorSteps, 5, "acid-base-titration");
    const discordant = result.violations.find((v) => v.code === "discordant_replicate");
    expect(discordant).toBeUndefined();
  });

  it("DOES flag genuinely scattered replicates of the same role (repeat titrations disagreeing)", () => {
    // Step 5 (final, expected 24.5) already recorded at 24.5; step 7 (repeat, also
    // expected 24.5) comes in at 25.3 — same role, way outside 0.1 mL concordance.
    const priorSteps = [stepRecord(1, 0.0), stepRecord(3, 0.0), stepRecord(5, 24.5)];
    const result = checkPhysicalConstraints(25.3, "burette_reading", priorSteps, 7, "acid-base-titration");
    const discordant = result.violations.find((v) => v.code === "discordant_replicate");
    expect(discordant).toBeDefined();
  });

  it("flags genuinely concordant repeat titrations as clean", () => {
    const priorSteps = [stepRecord(1, 0.0), stepRecord(3, 0.0), stepRecord(5, 24.5)];
    const result = checkPhysicalConstraints(24.52, "burette_reading", priorSteps, 7, "acid-base-titration");
    const discordant = result.violations.find((v) => v.code === "discordant_replicate");
    expect(discordant).toBeUndefined();
  });
});
