import { describe, expect, it } from "vitest";

import { computeHypothesisVerdict } from "@/server/tools/summary";

describe("hypothesis vs. actual result comparison", () => {
  it("no hypothesis written → null, nothing to show", () => {
    expect(computeHypothesisVerdict(null, 0.1)).toBeNull();
  });

  it("hypothesis written but no result yet → null, can't judge it yet", () => {
    expect(computeHypothesisVerdict("I predict 0.1 mol/L", null)).toBeNull();
  });

  it("a close numeric prediction (within 5%) reads as a win", () => {
    const v = computeHypothesisVerdict("I think it'll be about 0.1 mol/L because of the stoichiometry", 0.102);
    expect(v).not.toBeNull();
    expect(v!.toLowerCase()).toMatch(/nailed/);
    expect(v).toContain("0.1");
    expect(v).toContain("0.102");
  });

  it("a moderately off prediction (5-20%) reads as close but not exact", () => {
    const v = computeHypothesisVerdict("Around 0.1 mol/L", 0.115);
    expect(v!.toLowerCase()).toMatch(/close/);
  });

  it("a badly off prediction (>20%) reads as a miss, not sugar-coated", () => {
    const v = computeHypothesisVerdict("I predict 0.1 mol/L", 0.5);
    expect(v!.toLowerCase()).toMatch(/off/);
  });

  it("a non-numeric hypothesis still gets an honest, non-fabricated verdict", () => {
    const v = computeHypothesisVerdict("The solution will turn pink at the endpoint", 24.5);
    expect(v).toContain("no specific number");
    expect(v).toContain("24.5");
  });

  it("a predicted value of exactly 0 is not divided by (would be Infinity/NaN)", () => {
    expect(computeHypothesisVerdict("I predict 0", 5)).toBeNull();
  });
});
