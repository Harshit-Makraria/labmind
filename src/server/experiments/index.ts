/** Experiment registry — the test library (3 ready-to-run experiments). */
import "server-only";
import type { Experiment, ExperimentMeta, Protocol } from "@/lib/types";
import { TITRATION } from "./titration";
import { GEL_ELECTROPHORESIS } from "./gel-electrophoresis";
import { IODINE_CLOCK } from "./iodine-clock";
import { AUR } from "./aur";

export const EXPERIMENTS: Experiment[] = [TITRATION, GEL_ELECTROPHORESIS, IODINE_CLOCK, AUR];

export const DEFAULT_EXPERIMENT_ID = TITRATION.id;

export function getExperiment(id?: string): Experiment {
  return EXPERIMENTS.find((e) => e.id === id) ?? TITRATION;
}

export function listExperiments(): ExperimentMeta[] {
  return EXPERIMENTS.map(({ protocol: _protocol, ...meta }) => meta);
}

export function getProtocol(id?: string): Protocol {
  return getExperiment(id).protocol;
}

/** Fallback raw text fed to the parser when a PDF can't be read (titration). */
export const SAMPLE_LAB_TEXT = `
Acid-Base Titration — Determination of the concentration of an unknown HCl solution.
1. Prepare the burette: rinse with distilled water, fill with 0.1M NaOH to 0.00 mL.
2. Prepare the conical flask: pipette 25.0 mL of unknown HCl, add 3 drops phenolphthalein.
3. Record the initial burette reading.
4. Titrate: add NaOH dropwise while swirling, stop at the first permanent pink colour.
5. Record the final burette reading and calculate the volume of NaOH used.
6. Calculate the concentration of HCl using n(NaOH)=CV, n(HCl)=n(NaOH), C=n/0.025.
7. Repeat the titration twice more; use the mean of concordant results.
8. Record your calculated mean HCl concentration.
`;
