import { describe, expect, it } from "vitest";

import { EXPERIMENTS, getExperiment, listExperiments } from "@/server/experiments";

describe("experiment library", () => {
  it("ships at least 3 experiments across domains", () => {
    expect(EXPERIMENTS.length).toBeGreaterThanOrEqual(3);
    const domains = new Set(EXPERIMENTS.map((e) => e.domain));
    expect(domains.has("chemistry")).toBe(true);
    expect(domains.has("biology")).toBe(true);
    expect(domains.has("kinetics")).toBe(true);
  });

  it("each experiment is internally consistent", () => {
    for (const e of EXPERIMENTS) {
      expect(e.protocol.steps.length).toBe(e.step_count);
      expect(e.protocol.steps[0].step_number).toBe(1);
      expect(e.theoretical.value).toBeGreaterThan(0);
      // step numbers are sequential
      e.protocol.steps.forEach((s, i) => expect(s.step_number).toBe(i + 1));
    }
  });

  it("getExperiment falls back to titration for unknown ids", () => {
    expect(getExperiment("does-not-exist").id).toBe("acid-base-titration");
  });

  it("listExperiments omits the heavy protocol payload", () => {
    const meta = listExperiments();
    expect(meta).toHaveLength(EXPERIMENTS.length);
    expect((meta[0] as unknown as { protocol?: unknown }).protocol).toBeUndefined();
  });

  it("titration encodes cross-step dependencies", () => {
    const titration = getExperiment("acid-base-titration");
    const step1 = titration.protocol.steps[0];
    expect(step1.affects_steps?.length).toBeGreaterThan(0);
  });
});
