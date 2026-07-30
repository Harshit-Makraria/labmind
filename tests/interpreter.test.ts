import { describe, expect, it } from "vitest";

import { interpret } from "@/server/tools/result-interpreter";

const base = { session_id: "t", unit: "mol/L" };

describe("result interpreter (golden dataset)", () => {
  it("1% deviation → green", () => {
    const r = interpret({ ...base, student_result: 0.099, theoretical_value: 0.1, experiment_id: "acid-base-titration" });
    expect(r.deviation_percent).toBe(1);
    expect(r.severity).toBe("green");
  });

  it("6% deviation → amber with under-titration / parallax diagnosis", () => {
    const r = interpret({ ...base, student_result: 0.094, theoretical_value: 0.1, experiment_id: "acid-base-titration" });
    expect(r.deviation_percent).toBe(6);
    expect(r.severity).toBe("amber");
    expect(r.diagnosis.toLowerCase()).toMatch(/under-titration|parallax/);
  });

  it(">10% deviation → red", () => {
    const r = interpret({ ...base, student_result: 0.12, theoretical_value: 0.1, experiment_id: "acid-base-titration" });
    expect(r.severity).toBe("red");
  });

  it("is experiment-aware: kinetics talks about timing", () => {
    const r = interpret({ ...base, student_result: 0.0225, theoretical_value: 0.025, experiment_id: "iodine-clock" });
    expect(r.severity).toBe("amber");
    expect(`${r.diagnosis} ${r.improvement} ${r.learning_point}`.toLowerCase()).toMatch(/time|stopwatch|colour|rate/);
  });

  it("is experiment-aware: biology talks about the ladder/gel", () => {
    const r = interpret({ ...base, student_result: 1200, theoretical_value: 1500, experiment_id: "gel-electrophoresis" });
    expect(`${r.diagnosis} ${r.improvement} ${r.learning_point}`.toLowerCase()).toMatch(/ladder|gel|fragment|run/);
  });

  it("is experiment-aware: AUR gets its own absorbance/cuvette copy, not titration's burette/NaOH text", () => {
    const r = interpret({ ...base, unit: "AU", student_result: 0.094, theoretical_value: 0.1, experiment_id: "aur-experiment" });
    const text = `${r.diagnosis} ${r.improvement} ${r.learning_point}`.toLowerCase();
    expect(text).toMatch(/cuvette|absorbance|blank|beer-lambert/);
    expect(text).not.toMatch(/burette|naoh|titre|titration/);
  });

  it("AUR red severity flags out-of-linear-range concentration, not a burette misread", () => {
    const r = interpret({ ...base, unit: "AU", student_result: 0.13, theoretical_value: 0.1, experiment_id: "aur-experiment" });
    expect(r.severity).toBe("red");
    expect(r.diagnosis.toLowerCase()).toMatch(/wavelength|blank|linear range/);
  });
});
