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

  it("falls back to the generic descriptive instruction for an unrecognised type", () => {
    // @ts-expect-error — deliberately testing the fallback branch with an unknown type
    const instruction = buildCheckInstruction({ expected: { type: "unknown_type", expected_value: null, tolerance: 0 }, step_number: 1 });
    // An unknown type now routes to the universal description-driven check
    // rather than a bare "describe this image", so the step is still judged.
    expect(instruction).toMatch(/WHAT THIS STEP REQUIRES THE PHOTO TO SHOW/i);
    expect(instruction).toMatch(/observed_description/);
  });
});

describe("vision-check-flow — the universal descriptive check", () => {
  it("puts the instructor's own description in the prompt", () => {
    const instruction = buildCheckInstruction({
      expected: {
        type: "descriptive",
        expected_value: null,
        tolerance: 0,
        description: "The ammeter needle should be deflected and the circuit closed",
      },
      step_number: 3,
      experiment_id: "physics-ohms-law",
    });
    expect(instruction).toMatch(/The ammeter needle should be deflected/);
  });

  it("enumerates must_show and must_not_show criteria for independent checking", () => {
    const instruction = buildCheckInstruction({
      expected: {
        type: "descriptive",
        expected_value: null,
        tolerance: 0,
        description: "A correctly wired series circuit",
        must_show: ["battery connected", "bulb lit"],
        must_not_show: ["loose crocodile clip"],
      },
      step_number: 2,
    });
    expect(instruction).toMatch(/battery connected/);
    expect(instruction).toMatch(/bulb lit/);
    expect(instruction).toMatch(/loose crocodile clip/);
  });

  it("never reveals the expected numeric value — the anti-anchoring rule still holds", () => {
    // Handing the model the target is what made a 6 mL burette read as 24.5 mL.
    // A descriptive check may carry a numeric target, but the model must not
    // see it — the server compares afterwards.
    const instruction = buildCheckInstruction({
      expected: { type: "descriptive", expected_value: 0.52, tolerance: 0.05, description: "An ammeter display" },
      step_number: 4,
    });
    expect(instruction).not.toMatch(/0\.52/);
  });

  it("uses the description even when a legacy instrument type is also set", () => {
    // An instructor who wrote what the photo must show has said something more
    // specific than any generic instrument template can express.
    const instruction = buildCheckInstruction({
      expected: {
        type: "burette_reading",
        expected_value: 24.5,
        tolerance: 0.1,
        description: "A 25 mL pipette, not a burette",
      },
      step_number: 1,
    });
    expect(instruction).toMatch(/A 25 mL pipette, not a burette/);
    expect(instruction).not.toMatch(/24\.5/);
  });

  it("still uses the hand-tuned burette reader when no description is given", () => {
    const instruction = buildCheckInstruction({
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
      step_number: 1,
    });
    expect(instruction).toMatch(/This photograph shows a burette/);
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
