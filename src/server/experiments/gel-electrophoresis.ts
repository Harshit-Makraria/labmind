/** Experiment 2 — Gel Electrophoresis (biology; proves multi-domain + gel_band vision). */
import "server-only";
import type { Experiment } from "@/lib/types";

export const GEL_ELECTROPHORESIS: Experiment = {
  id: "gel-electrophoresis",
  name: "DNA Gel Electrophoresis",
  domain: "biology",
  difficulty: "intermediate",
  duration_minutes: 90,
  description:
    "Separate DNA fragments by size on a 1% agarose gel and estimate an unknown fragment's length (bp) against a ladder.",
  hazard_level: "medium",
  theoretical: { label: "Unknown fragment size", value: 1500, unit: "bp" },
  step_count: 8,
  reagent_names: ["agarose", "TAE buffer", "SYBR Safe", "DNA ladder", "loading dye", "ethanol"],
  protocol: {
    experiment_name: "DNA Gel Electrophoresis",
    steps: [
      {
        step_number: 1,
        title: "Cast the Agarose Gel",
        instructions: [
          "Mix 1.0 g agarose in 100 mL 1× TAE buffer",
          "Microwave until fully dissolved, then cool to ~55°C",
        ],
        reagents: [
          { name: "agarose", concentration: "1%", volume_ml: 100 },
          { name: "TAE buffer", concentration: "1×", volume_ml: 100 },
        ],
        duration_seconds: 300,
        safety_flags: ["Hot liquid — use heat-resistant gloves"],
        science_explanation:
          "Agarose forms a porous matrix; 1% resolves fragments roughly 0.5–10 kb.",
        expected_observation: "Clear, bubble-free molten gel",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [2, 6],
      },
      {
        step_number: 2,
        title: "Add Stain & Pour",
        instructions: [
          "Add 10 µL SYBR Safe to the cooled gel",
          "Pour into the tray and insert the comb",
        ],
        reagents: [{ name: "SYBR Safe", volume_ml: null }],
        duration_seconds: 1200,
        safety_flags: ["SYBR Safe binds DNA — wear gloves"],
        science_explanation:
          "SYBR Safe intercalates DNA and fluoresces under blue light, making bands visible.",
        expected_observation: "Gel set firm with clean wells",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [6],
      },
      {
        step_number: 3,
        title: "Prepare Samples",
        instructions: [
          "Mix 5 µL DNA sample with 1 µL 6× loading dye",
          "Prepare the DNA ladder the same way",
        ],
        reagents: [
          { name: "loading dye", concentration: "6×", volume_ml: null },
          { name: "DNA ladder", volume_ml: null },
        ],
        duration_seconds: 180,
        safety_flags: [],
        science_explanation:
          "Loading dye adds density (sample sinks into the well) and tracks the migration front.",
        expected_observation: "Blue-tinted, dense samples ready to load",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [4, 7],
      },
      {
        step_number: 4,
        title: "Load the Wells",
        instructions: [
          "Load the ladder in lane 1",
          "Load each sample into successive wells, 6 µL per well",
        ],
        reagents: [],
        duration_seconds: 300,
        safety_flags: [],
        science_explanation:
          "A size ladder in a reference lane lets you interpolate unknown fragment sizes.",
        expected_observation: "Dye visible in each loaded well",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [6, 7],
      },
      {
        step_number: 5,
        title: "Run the Gel",
        instructions: [
          "Connect leads (DNA runs toward the red/positive electrode)",
          "Run at 100 V for ~40 minutes",
        ],
        reagents: [{ name: "TAE buffer", concentration: "1×" }],
        duration_seconds: 2400,
        safety_flags: ["High voltage — lid on before powering, hands off while running"],
        science_explanation:
          "DNA is negatively charged and migrates to the anode; smaller fragments travel farther.",
        expected_observation: "Dye front migrated ~⅔ down the gel",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [6],
      },
      {
        step_number: 6,
        title: "Image the Gel",
        instructions: [
          "Place the gel on the blue-light transilluminator",
          "Photograph the band pattern",
        ],
        reagents: [],
        duration_seconds: 120,
        safety_flags: ["Use the amber shield with the transilluminator"],
        science_explanation:
          "Band position relative to the ladder reveals fragment size.",
        expected_observation: "Distinct ladder bands + sample bands",
        vision_check_required: true,
        vision_expected: { type: "gel_band", expected_value: 1500, tolerance: 150 },
        affects_steps: [7, 8],
      },
      {
        step_number: 7,
        title: "Estimate Fragment Size",
        instructions: [
          "Compare the unknown band against the ladder",
          "Interpolate the fragment size in base pairs",
        ],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "Migration distance is inversely proportional to log(size); read off the ladder.",
        expected_observation: "Unknown band aligns near the 1.5 kb marker",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [8],
      },
      {
        step_number: 8,
        title: "Record Results",
        instructions: ["Enter the estimated fragment size in bp"],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation: "Your size estimate is the experiment's measured outcome.",
        expected_observation: "Final answer recorded",
        vision_check_required: false,
        vision_expected: null,
      },
    ],
  },
};
