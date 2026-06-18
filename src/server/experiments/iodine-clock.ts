/** Experiment 3 — Iodine Clock Reaction (kinetics; timing-critical + colour change). */
import "server-only";
import type { Experiment } from "@/lib/types";

export const IODINE_CLOCK: Experiment = {
  id: "iodine-clock",
  name: "Iodine Clock Reaction",
  domain: "kinetics",
  difficulty: "advanced",
  duration_minutes: 60,
  description:
    "Measure reaction rate by timing the sudden blue-black colour change, then determine the rate of reaction (1/time).",
  hazard_level: "medium",
  theoretical: { label: "Reaction rate (1/t)", value: 0.025, unit: "s⁻¹" },
  step_count: 7,
  reagent_names: ["KI", "Na2S2O3", "H2O2", "H2SO4", "starch"],
  protocol: {
    experiment_name: "Iodine Clock Reaction",
    steps: [
      {
        step_number: 1,
        title: "Prepare Solution A",
        instructions: [
          "Measure 25 mL of 0.2M potassium iodide (KI)",
          "Add 10 mL of 0.05M sodium thiosulfate (Na2S2O3)",
          "Add 5 mL of 1% starch indicator",
        ],
        reagents: [
          { name: "KI", concentration: "0.2M", volume_ml: 25 },
          { name: "Na2S2O3", concentration: "0.05M", volume_ml: 10 },
          { name: "starch", concentration: "1%", volume_ml: 5 },
        ],
        duration_seconds: 180,
        safety_flags: [],
        science_explanation:
          "Thiosulfate consumes the first iodine produced; starch will signal once it runs out.",
        expected_observation: "Clear, colourless solution A",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [4, 5],
      },
      {
        step_number: 2,
        title: "Prepare Solution B",
        instructions: [
          "Measure 20 mL of 0.1M hydrogen peroxide (H2O2)",
          "Add 5 mL of 1M sulfuric acid (H2SO4)",
        ],
        reagents: [
          { name: "H2O2", concentration: "0.1M", volume_ml: 20 },
          { name: "H2SO4", concentration: "1M", volume_ml: 5 },
        ],
        duration_seconds: 120,
        safety_flags: ["H2SO4 is corrosive — add acid to water, wear goggles"],
        science_explanation:
          "Acidified peroxide is the oxidant that converts iodide to iodine.",
        expected_observation: "Clear, colourless solution B",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [4, 5],
      },
      {
        step_number: 3,
        title: "Set Up Timing",
        instructions: [
          "Have a stopwatch ready",
          "Place solution A on a white tile for contrast",
        ],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "The colour change is sudden; an accurate start time is essential for the rate.",
        expected_observation: "Stopwatch ready at zero",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [4],
      },
      {
        step_number: 4,
        title: "Mix & Start Clock",
        instructions: [
          "Pour solution B into A and start the stopwatch immediately",
          "Swirl once to mix",
        ],
        reagents: [
          { name: "KI", concentration: "0.2M" },
          { name: "H2O2", concentration: "0.1M" },
          { name: "H2SO4", concentration: "1M" },
        ],
        duration_seconds: null,
        safety_flags: ["Mixing oxidiser with acid — do not inhale, work in ventilation"],
        science_explanation:
          "Now iodine is being produced steadily but mopped up by thiosulfate — no colour yet.",
        expected_observation: "Solution stays colourless (clock running)",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [5, 6],
      },
      {
        step_number: 5,
        title: "Capture Colour Change",
        instructions: [
          "Watch for the sudden blue-black colour",
          "Photograph the flask the instant it turns",
        ],
        reagents: [{ name: "starch", concentration: "1%" }],
        duration_seconds: 60,
        safety_flags: [],
        science_explanation:
          "When thiosulfate is exhausted, free iodine binds starch → instant blue-black.",
        expected_observation: "Sharp blue-black colour around 40 s",
        vision_check_required: true,
        vision_expected: { type: "colour_change", expected_value: null, tolerance: 0.0 },
        affects_steps: [6, 7],
      },
      {
        step_number: 6,
        title: "Record the Time",
        instructions: [
          "Stop the clock at the colour change",
          "Record the elapsed time in seconds",
        ],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "Elapsed time is inversely proportional to the reaction rate.",
        expected_observation: "Time recorded (≈40 s)",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [7],
      },
      {
        step_number: 7,
        title: "Calculate Rate",
        instructions: ["Compute rate = 1 / time (s⁻¹)", "Enter your calculated rate"],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "Rate = 1/t approximates the initial rate for this clock reaction.",
        expected_observation: "Rate near 0.025 s⁻¹",
        vision_check_required: false,
        vision_expected: null,
      },
    ],
  },
};
