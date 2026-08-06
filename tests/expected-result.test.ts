import { describe, it, expect } from "vitest";
import { resolveExpectedResult, gradeResult } from "@/server/tools/expected-result";
import type { Experiment, ExpectedResult, Protocol } from "@/lib/types";

const LIBRARY: Experiment = {
  id: "acid-base-titration",
  name: "Acid-Base Titration",
  domain: "chemistry",
  difficulty: "beginner",
  duration_minutes: 45,
  description: "",
  hazard_level: "medium",
  theoretical: { label: "HCl concentration", value: 0.1, unit: "mol/L" },
  step_count: 8,
  reagent_names: [],
  protocol: { experiment_name: "Acid-Base Titration", steps: [] },
};

const protocolWith = (expected_result: ExpectedResult | null): Protocol => ({
  experiment_name: "Custom",
  steps: [],
  expected_result,
});

describe("resolveExpectedResult — a custom experiment is graded against ITS OWN target", () => {
  it("uses the protocol's own expected result over the library experiment's", () => {
    // The bug this fixes: an instructor uploads a redox titration expecting
    // 0.02 mol/L KMnO4, but grading used the library titration's 0.1 mol/L.
    const r = resolveExpectedResult(
      protocolWith({ kind: "numeric", label: "KMnO4 molarity", value: 0.02, unit: "mol/L" }),
      LIBRARY,
    );
    expect(r.value).toBe(0.02);
    expect(r.label).toBe("KMnO4 molarity");
  });

  it("falls back to the library experiment when the protocol declares nothing", () => {
    const r = resolveExpectedResult(protocolWith(null), LIBRARY);
    expect(r.kind).toBe("numeric");
    expect(r.value).toBe(0.1);
  });

  it("falls back when the protocol declares a numeric result with no value", () => {
    // A half-extracted target would otherwise become a 0 target and grade
    // every student at 0% deviation.
    const r = resolveExpectedResult(
      protocolWith({ kind: "numeric", label: "Nothing" } as ExpectedResult),
      LIBRARY,
    );
    expect(r.value).toBe(0.1);
  });

  it("falls back when a categorical result has no options or answer key", () => {
    const r = resolveExpectedResult(protocolWith({ kind: "categorical", label: "Tissue" }), LIBRARY);
    expect(r.kind).toBe("numeric");
  });

  it("handles a null/undefined protocol (library experiments)", () => {
    expect(resolveExpectedResult(null, LIBRARY).value).toBe(0.1);
    expect(resolveExpectedResult(undefined, LIBRARY).value).toBe(0.1);
  });
});

describe("gradeResult — numeric", () => {
  const expected: ExpectedResult = { kind: "numeric", label: "c", value: 0.1, unit: "mol/L" };

  it("computes percent deviation", () => {
    expect(gradeResult(expected, { numeric: 0.09 }).deviationPercent).toBe(10);
  });

  it("treats over and under symmetrically", () => {
    expect(gradeResult(expected, { numeric: 0.11 }).deviationPercent).toBe(10);
  });

  it("returns 0% for an exact match", () => {
    expect(gradeResult(expected, { numeric: 0.1 }).deviationPercent).toBe(0);
  });

  it("handles a negative expected value without a negative deviation", () => {
    const neg: ExpectedResult = { kind: "numeric", label: "ΔH", value: -50, unit: "kJ" };
    expect(gradeResult(neg, { numeric: -45 }).deviationPercent).toBe(10);
  });

  it("reports null rather than a fake 0% when nothing was submitted", () => {
    expect(gradeResult(expected, { numeric: null }).deviationPercent).toBeNull();
  });

  it("applies tolerance when the protocol states one", () => {
    const tol: ExpectedResult = { kind: "numeric", label: "c", value: 0.1, tolerance: 0.005 };
    expect(gradeResult(tol, { numeric: 0.103 }).correct).toBe(true);
    expect(gradeResult(tol, { numeric: 0.12 }).correct).toBe(false);
  });
});

describe("gradeResult — categorical (microscopy, identification labs)", () => {
  const expected: ExpectedResult = {
    kind: "categorical",
    label: "Tissue type",
    options: ["Cardiac muscle", "Skeletal muscle", "Smooth muscle"],
    correct: "Cardiac muscle",
  };

  it("marks the right answer correct", () => {
    expect(gradeResult(expected, { answer: "Cardiac muscle" }).correct).toBe(true);
  });

  it("marks a wrong answer incorrect", () => {
    expect(gradeResult(expected, { answer: "Smooth muscle" }).correct).toBe(false);
  });

  it("is case and whitespace insensitive", () => {
    expect(gradeResult(expected, { answer: "  cardiac   MUSCLE " }).correct).toBe(true);
  });

  it("accepts any of several valid answers", () => {
    const multi: ExpectedResult = { kind: "categorical", label: "x", options: ["a", "b"], correct: ["a", "b"] };
    expect(gradeResult(multi, { answer: "b" }).correct).toBe(true);
  });

  it("never reports a deviation percent", () => {
    expect(gradeResult(expected, { answer: "Cardiac muscle" }).deviationPercent).toBeNull();
  });
});

describe("gradeResult — boolean (circuit works / program compiles)", () => {
  const expected: ExpectedResult = { kind: "boolean", label: "Circuit closed", correct: true };

  it("grades a real boolean", () => {
    expect(gradeResult(expected, { answer: true }).correct).toBe(true);
    expect(gradeResult(expected, { answer: false }).correct).toBe(false);
  });

  it("accepts yes/no strings from the form", () => {
    expect(gradeResult(expected, { answer: "yes" }).correct).toBe(true);
    expect(gradeResult(expected, { answer: "no" }).correct).toBe(false);
  });

  it("reports null when nothing was answered", () => {
    expect(gradeResult(expected, { answer: null }).correct).toBeNull();
  });
});

describe("gradeResult — qualitative is never auto-graded", () => {
  const expected: ExpectedResult = { kind: "qualitative", label: "Observation", rubric: "Describes the colour change" };

  it("records the answer without asserting correct or incorrect", () => {
    // Asserting a pass/fail from a keyword match would be a confident wrong
    // answer — worse than an honest "needs review".
    const out = gradeResult(expected, { answer: "The solution turned pale pink and stayed pink." });
    expect(out.correct).toBeNull();
    expect(out.deviationPercent).toBeNull();
  });
});

describe("gradeResult — none", () => {
  it("produces no grade at all", () => {
    const out = gradeResult({ kind: "none", label: "n/a" }, {});
    expect(out.correct).toBeNull();
    expect(out.deviationPercent).toBeNull();
  });
});

describe("custom experiments must not inherit chemistry coaching", () => {
  it("gives subject-neutral advice for a custom numeric experiment", async () => {
    const { interpretUniversal } = await import("@/server/tools/result-interpreter");
    const expected: ExpectedResult = { kind: "numeric", label: "Resistance of the wire", value: 4.7, unit: "Ω", tolerance: 0.2 };
    const out = interpretUniversal(
      expected,
      { numeric: 4.69 },
      { session_id: "s", student_result: 4.69, unit: "Ω", theoretical_value: 4.7 },
      { custom: true },
    );
    // A physics experiment was previously told "your titration technique was
    // sound" and to "read the meniscus at eye level".
    expect(out.diagnosis).not.toMatch(/titration|meniscus|burette|titre/i);
    expect(out.improvement).not.toMatch(/titration|meniscus|burette|titre/i);
    expect(out.learning_point).not.toMatch(/titration|meniscus|burette|titre/i);
    expect(out.deviation_percent).toBe(0.2);
    expect(out.severity).toBe("green");
  });

  it("still gives the library titration its own experiment-aware coaching", async () => {
    const { interpretUniversal } = await import("@/server/tools/result-interpreter");
    const expected: ExpectedResult = { kind: "numeric", label: "HCl concentration", value: 0.1, unit: "mol/L" };
    const out = interpretUniversal(
      expected,
      { numeric: 0.0999 },
      { session_id: "s", student_result: 0.0999, unit: "mol/L", theoretical_value: 0.1, experiment_id: "acid-base-titration" },
    );
    expect(out.diagnosis).toMatch(/titration/i);
  });

  it("uses the declared tolerance to decide severity, not a fixed percentage", async () => {
    const { interpretUniversal } = await import("@/server/tools/result-interpreter");
    const tight: ExpectedResult = { kind: "numeric", label: "Focal length", value: 20, unit: "cm", tolerance: 0.1 };
    const out = interpretUniversal(
      tight,
      { numeric: 20.5 },
      { session_id: "s", student_result: 20.5, unit: "cm", theoretical_value: 20 },
      { custom: true },
    );
    // 2.5% would be "green" on the default percentage bands, but it is outside
    // the experiment's own stated tolerance.
    expect(out.correct).toBe(false);
    expect(out.severity).not.toBe("green");
  });
});
