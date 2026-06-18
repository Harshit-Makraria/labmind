/** Experiment 1 — Acid-Base Titration (flagship, from spec §9.1). */
import "server-only";
import type { Experiment } from "@/lib/types";

export const TITRATION: Experiment = {
  id: "acid-base-titration",
  name: "Acid-Base Titration",
  domain: "chemistry",
  difficulty: "beginner",
  duration_minutes: 45,
  description:
    "Determine the concentration of an unknown HCl solution by titrating against 0.1M NaOH with a phenolphthalein endpoint.",
  hazard_level: "medium",
  theoretical: { label: "HCl concentration", value: 0.1, unit: "mol/L" },
  step_count: 8,
  reagent_names: ["NaOH", "HCl", "phenolphthalein"],
  protocol: {
    experiment_name: "Acid-Base Titration",
    steps: [
      {
        step_number: 1,
        title: "Prepare Burette",
        instructions: [
          "Rinse burette with distilled water",
          "Fill with 0.1M NaOH to the 0.00 mL mark",
        ],
        reagents: [{ name: "NaOH", concentration: "0.1M", volume_ml: 50 }],
        duration_seconds: 300,
        safety_flags: [],
        science_explanation: "Rinsing removes contaminants that alter molarity.",
        expected_observation: "Burette reads 0.00 mL at start",
        vision_check_required: true,
        vision_expected: { type: "burette_reading", expected_value: 0.0, tolerance: 0.1 },
        affects_steps: [3, 4, 5],
      },
      {
        step_number: 2,
        title: "Prepare Conical Flask",
        instructions: [
          "Pipette 25.0 mL of HCl (unknown conc.) into flask",
          "Add 3 drops of phenolphthalein indicator",
        ],
        reagents: [
          { name: "HCl", concentration: "unknown", volume_ml: 25 },
          { name: "phenolphthalein", volume_ml: null },
        ],
        duration_seconds: 120,
        safety_flags: ["HCl handling — wear gloves and goggles"],
        science_explanation:
          "Phenolphthalein is colourless in acid, pink in base — it marks the endpoint.",
        expected_observation: "Colourless solution in flask",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [4, 6],
      },
      {
        step_number: 3,
        title: "Initial Burette Reading",
        instructions: ["Record the initial burette reading before titration begins"],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "An accurate start reading is required to compute volume delivered.",
        expected_observation: "Burette reads at or near 0.00 mL",
        vision_check_required: true,
        vision_expected: { type: "burette_reading", expected_value: 0.0, tolerance: 0.1 },
        affects_steps: [5, 6],
      },
      {
        step_number: 4,
        title: "Titrate to Endpoint",
        instructions: [
          "Add NaOH dropwise while swirling the flask",
          "Stop at the first permanent pink colour",
        ],
        reagents: [
          { name: "NaOH", concentration: "0.1M" },
          { name: "HCl", concentration: "unknown" },
        ],
        duration_seconds: 600,
        safety_flags: ["Exothermic neutralization — swirl gently"],
        science_explanation:
          "NaOH neutralizes HCl; the endpoint is the equivalence point.",
        expected_observation: "First permanent faint pink colour",
        vision_check_required: true,
        vision_expected: { type: "colour_change", expected_value: null, tolerance: 0.0 },
        affects_steps: [5, 6],
      },
      {
        step_number: 5,
        title: "Final Burette Reading",
        instructions: [
          "Record the final burette reading",
          "Calculate volume of NaOH used (final − initial)",
        ],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "Titre volume is the difference between final and initial readings.",
        expected_observation: "Burette reads around 24.5 mL",
        vision_check_required: true,
        vision_expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
        affects_steps: [6],
      },
      {
        step_number: 6,
        title: "Calculate Concentration",
        instructions: ["Use n(NaOH) = C × V", "n(HCl) = n(NaOH)", "C(HCl) = n / 0.025"],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "Stoichiometry: a 1:1 mole ratio links NaOH delivered to HCl present.",
        expected_observation: "Calculated concentration near 0.1 mol/L",
        vision_check_required: false,
        vision_expected: null,
        affects_steps: [8],
      },
      {
        step_number: 7,
        title: "Repeat Titration",
        instructions: [
          "Perform 2 more titrations",
          "Use the mean of concordant results (within 0.1 mL)",
        ],
        reagents: [
          { name: "NaOH", concentration: "0.1M" },
          { name: "HCl", concentration: "unknown" },
        ],
        duration_seconds: 600,
        safety_flags: [],
        science_explanation:
          "Repeats reduce random error; concordance confirms precision.",
        expected_observation: "Concordant titres within 0.1 mL",
        vision_check_required: true,
        vision_expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
        affects_steps: [8],
      },
      {
        step_number: 8,
        title: "Record Results",
        instructions: ["Enter your calculated mean HCl concentration"],
        reagents: [],
        duration_seconds: null,
        safety_flags: [],
        science_explanation:
          "The mean concordant result is your best estimate of the unknown concentration.",
        expected_observation: "Final answer recorded",
        vision_check_required: false,
        vision_expected: null,
      },
    ],
  },
};
