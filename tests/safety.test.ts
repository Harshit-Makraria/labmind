import { describe, expect, it } from "vitest";

import { checkSafety } from "@/server/tools/safety";

describe("safety engine (golden dataset)", () => {
  it("flags HCl + NaOH as a medium conflict", () => {
    const res = checkSafety([{ name: "HCl" }, { name: "NaOH" }], []);
    expect(res.conflict).toBe(true);
    expect(res.alerts[0].severity).toBe("medium");
    expect(res.alerts[0].type).toMatch(/Neutralization/i);
  });

  it("no conflict for NaOH + phenolphthalein", () => {
    const res = checkSafety([{ name: "NaOH" }, { name: "phenolphthalein" }], []);
    expect(res.conflict).toBe(false);
    expect(res.alerts).toHaveLength(0);
  });

  it("detects a conflict against reagent history (not just current step)", () => {
    const res = checkSafety([{ name: "NaOH" }], [{ name: "HCl" }]);
    expect(res.conflict).toBe(true);
  });

  it("raises a high concentration warning above threshold", () => {
    const res = checkSafety([{ name: "HCl", concentration: "8M" }], []);
    expect(res.conflict).toBe(true);
    expect(res.alerts.some((a) => a.severity === "high")).toBe(true);
  });

  it("sorts alerts by severity (high first)", () => {
    const res = checkSafety([{ name: "NaOCl" }, { name: "HCl", concentration: "8M" }], []);
    expect(res.alerts[0].severity).toBe("high");
  });
});
