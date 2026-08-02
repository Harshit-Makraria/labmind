import { describe, expect, it } from "vitest";

import { analysePacing } from "@/server/tools/pacing";
import type { Protocol, ProtocolStep, StepRecord } from "@/lib/types";

function step(overrides: Partial<ProtocolStep> & { step_number: number; title: string }): ProtocolStep {
  return {
    instructions: [],
    reagents: [],
    duration_seconds: null,
    safety_flags: [],
    science_explanation: "",
    expected_observation: "",
    vision_check_required: false,
    vision_expected: null,
    ...overrides,
  };
}

function rec(step_number: number, completedAt: string | null): StepRecord {
  return {
    step_number,
    state: completedAt ? "completed" : "pending",
    flagged: false,
    vision_attempts: 0,
    vision_reading: null,
    vision_pass: null,
    manual_override: null,
    completed_at: completedAt,
  };
}

const START = new Date("2026-01-01T00:00:00Z");
function at(secondsAfterStart: number): string {
  return new Date(START.getTime() + secondsAfterStart * 1000).toISOString();
}

describe("analysePacing", () => {
  it("flags a step completed under the absolute floor (5s) as no_dwell, even a non-observation step", () => {
    const protocol: Protocol = { experiment_name: "t", steps: [step({ step_number: 1, title: "Weigh sample" })] };
    const report = analysePacing([rec(1, at(3))], protocol, START);
    expect(report.steps[0].flag).toBe("no_dwell");
    expect(report.flagged_count).toBe(1);
  });

  it("flags an observation step (matches /titrat|observ|.../ or requires vision) completed under the observation floor, even with no stated duration", () => {
    const protocol: Protocol = {
      experiment_name: "t",
      steps: [step({ step_number: 1, title: "Titrate to endpoint", duration_seconds: null })],
    };
    // 15s: above the absolute floor (5s) but below the observation floor (20s).
    const report = analysePacing([rec(1, at(15))], protocol, START);
    expect(report.steps[0].flag).toBe("impossibly_fast");
    expect(report.steps[0].reason).toContain("requires observation");
  });

  it("does not flag a non-observation step with no stated duration, even if fast (as long as it clears the absolute floor)", () => {
    const protocol: Protocol = { experiment_name: "t", steps: [step({ step_number: 1, title: "Record initial mass" })] };
    const report = analysePacing([rec(1, at(10))], protocol, START);
    expect(report.steps[0].flag).toBeNull();
    expect(report.verdict).toBe("consistent");
  });

  it("flags suspicious_uniformity across 4+ near-identical, sub-60s gaps, but only overwrites steps that weren't already flagged", () => {
    const protocol: Protocol = {
      experiment_name: "t",
      steps: [1, 2, 3, 4].map((n) => step({ step_number: n, title: `Step ${n}` })),
    };
    // Near-identical ~10s gaps (low stdev/mean, mean < 60s) across 4 steps.
    const steps = [rec(1, at(10)), rec(2, at(20)), rec(3, at(30)), rec(4, at(40))];
    const report = analysePacing(steps, protocol, START);
    expect(report.steps.every((s) => s.flag === "suspicious_uniformity")).toBe(true);
    expect(report.flagged_count).toBe(4);
  });

  it("verdict boundary: exactly 1/3 flagged (ratio 0.333, below the 0.34 cutoff) is review_recommended; 2/5 (0.4) is implausible", () => {
    const proto3: Protocol = { experiment_name: "t", steps: [1, 2, 3].map((n) => step({ step_number: n, title: `Step ${n}` })) };
    // 1 tiny step (flagged), 2 normal-length steps (not flagged) -> ratio 1/3.
    const oneThird = analysePacing([rec(1, at(2)), rec(2, at(2 + 100)), rec(3, at(2 + 100 + 200))], proto3, START);
    expect(oneThird.flagged_count).toBe(1);
    expect(oneThird.verdict).toBe("review_recommended");

    const proto5: Protocol = { experiment_name: "t", steps: [1, 2, 3, 4, 5].map((n) => step({ step_number: n, title: `Step ${n}` })) };
    // 2 tiny steps (flagged), 3 normal steps -> ratio 2/5 = 0.4.
    const twoFifths = analysePacing(
      [rec(1, at(2)), rec(2, at(4)), rec(3, at(4 + 100)), rec(4, at(4 + 100 + 150)), rec(5, at(4 + 100 + 150 + 200))],
      proto5,
      START,
    );
    expect(twoFifths.flagged_count).toBe(2);
    expect(twoFifths.verdict).toBe("implausible");
  });

  it("withholds a score (null, verdict no_data) when nothing is completed, rather than presenting an unstarted session as a perfect 100", () => {
    const protocol: Protocol = { experiment_name: "t", steps: [step({ step_number: 1, title: "Step 1" })] };
    const report = analysePacing([], protocol, START);
    expect(report.integrity_score).toBeNull();
    expect(report.verdict).toBe("no_data");
  });
});
