import { describe, expect, it } from "vitest";

import { buildCheckInstruction, parseImageCheckResponse } from "@/server/tools/vision-check-flow";

describe("vision-check-flow — NODE 1: buildCheckInstruction", () => {
  it("includes the experiment label and step number in every instruction", () => {
    const instruction = buildCheckInstruction({
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
      step_number: 5,
      experiment_id: "acid-base-titration",
    });
    expect(instruction).toMatch(/Acid-Base Titration/);
    expect(instruction).toMatch(/Step: 5/);
  });

  it("gives each vision-check type a distinct instruction", () => {
    const types = ["burette_reading", "gel_band", "absorbance", "colour_change"] as const;
    const instructions = types.map((type) =>
      buildCheckInstruction({ expected: { type, expected_value: null, tolerance: 0.1 }, step_number: 1 }),
    );
    expect(new Set(instructions).size).toBe(types.length);
    expect(instructions[0]).toMatch(/burette/i);
    expect(instructions[1]).toMatch(/gel|ladder/i);
    expect(instructions[2]).toMatch(/absorbance|spectrophotometer/i);
    expect(instructions[3]).toMatch(/colour|color/i);
  });

  it("never reveals the expected value — blind reading", () => {
    const instruction = buildCheckInstruction({
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
      step_number: 5,
    });
    expect(instruction).not.toMatch(/24\.5/);
  });

  it("falls back to a generic instruction for an unrecognised type", () => {
    // @ts-expect-error — deliberately testing the fallback branch with an unknown type
    const instruction = buildCheckInstruction({ expected: { type: "unknown_type", expected_value: null, tolerance: 0 }, step_number: 1 });
    expect(instruction).toMatch(/Report what is physically visible/i);
  });
});

describe("vision-check-flow — NODE 3: parseImageCheckResponse", () => {
  it("parses a clean JSON response", () => {
    const parsed = parseImageCheckResponse('{"reading": 24.5, "confidence": 0.9}');
    expect(parsed?.reading).toBe(24.5);
  });

  it("strips markdown code fences before parsing", () => {
    const parsed = parseImageCheckResponse('```json\n{"reading": 12.3}\n```');
    expect(parsed?.reading).toBe(12.3);
  });

  it("returns null for unparseable text instead of throwing", () => {
    expect(parseImageCheckResponse("not json at all")).toBeNull();
  });
});
