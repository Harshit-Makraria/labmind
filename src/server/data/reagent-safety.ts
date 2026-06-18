/**
 * Reagent safety knowledge base (Feature 3).
 * 22 conflict pairs + concentration thresholds. Embedded as TS (not read from disk)
 * so it bundles cleanly into serverless functions.
 */
import "server-only";
import type { Severity } from "@/lib/types";

export interface ConflictRule {
  reagents: [string, string];
  type: string;
  severity: Severity;
  description: string;
  action: string;
}

export interface ConcentrationRule {
  reagent: string;
  threshold_molarity: number;
  severity: Severity;
  message: string;
}

export const CONFLICTS: ConflictRule[] = [
  { reagents: ["HCl", "NaOH"], type: "Neutralization", severity: "medium", description: "Exothermic neutralization. Controlled in titration context.", action: "Proceed slowly. Swirl flask gently." },
  { reagents: ["H2SO4", "NaOH"], type: "Violent Neutralization", severity: "high", description: "Concentrated H2SO4 + NaOH: extreme exothermic reaction.", action: "STOP. Verify concentrations. Use dilute solutions only." },
  { reagents: ["KMnO4", "H2O2"], type: "Oxidizer Conflict", severity: "high", description: "KMnO4 acts as oxidizer; H2O2 as reductant — vigorous decomposition.", action: "Do not combine. Contact instructor immediately." },
  { reagents: ["H2SO4", "H2O"], type: "Exothermic Dilution", severity: "high", description: "Adding water to concentrated acid causes violent boiling and splattering.", action: "Always add acid to water, never water to acid." },
  { reagents: ["HNO3", "ethanol"], type: "Oxidizer + Organic", severity: "high", description: "Nitric acid oxidizes ethanol; risk of fire and toxic fumes.", action: "Do not mix. Keep oxidizers away from organics." },
  { reagents: ["NaOCl", "HCl"], type: "Toxic Gas Release", severity: "high", description: "Bleach + acid releases toxic chlorine gas.", action: "STOP. Ventilate immediately. Never combine bleach with acids." },
  { reagents: ["NaOCl", "NH3"], type: "Toxic Gas Release", severity: "high", description: "Bleach + ammonia produces chloramine vapours.", action: "STOP. Evacuate and ventilate. Never combine." },
  { reagents: ["K", "H2O"], type: "Violent Reaction", severity: "high", description: "Potassium reacts explosively with water, releasing hydrogen.", action: "Keep away from water. Store under oil." },
  { reagents: ["Na", "H2O"], type: "Violent Reaction", severity: "high", description: "Sodium reacts vigorously with water, igniting hydrogen gas.", action: "Keep away from water. Handle with dry tools." },
  { reagents: ["KMnO4", "glycerol"], type: "Spontaneous Ignition", severity: "high", description: "KMnO4 + glycerol can spontaneously combust.", action: "Do not combine. Keep separated." },
  { reagents: ["H2O2", "acetone"], type: "Explosive Peroxide", severity: "high", description: "Forms shock-sensitive acetone peroxide.", action: "Never combine. Dispose of peroxides carefully." },
  { reagents: ["HNO3", "HCl"], type: "Aqua Regia", severity: "high", description: "Forms aqua regia — highly corrosive, dissolves noble metals, releases toxic gas.", action: "Only prepare under supervision in a fume hood." },
  { reagents: ["AgNO3", "HCl"], type: "Precipitation", severity: "low", description: "Forms insoluble AgCl precipitate.", action: "Expected in qualitative analysis. Dispose of silver waste correctly." },
  { reagents: ["BaCl2", "H2SO4"], type: "Precipitation", severity: "low", description: "Forms insoluble BaSO4 precipitate; barium salts are toxic.", action: "Handle barium with gloves; collect precipitate as solid waste." },
  { reagents: ["CaC2", "H2O"], type: "Flammable Gas Release", severity: "high", description: "Calcium carbide + water releases flammable acetylene gas.", action: "Keep dry. No open flames nearby." },
  { reagents: ["Zn", "HCl"], type: "Flammable Gas Release", severity: "medium", description: "Produces hydrogen gas — flammable in confined spaces.", action: "Work in a ventilated area, away from flames." },
  { reagents: ["NH4NO3", "heat"], type: "Thermal Decomposition", severity: "high", description: "Ammonium nitrate decomposes explosively on strong heating.", action: "Do not heat strongly. Keep away from confinement." },
  { reagents: ["CuSO4", "NaOH"], type: "Precipitation", severity: "low", description: "Forms blue Cu(OH)2 precipitate.", action: "Expected reaction. Dispose of copper waste correctly." },
  { reagents: ["Pb(NO3)2", "KI"], type: "Precipitation", severity: "medium", description: "Forms yellow PbI2 precipitate; lead salts are toxic.", action: "Handle lead salts with care; collect as hazardous solid waste." },
  { reagents: ["acetic acid", "NaHCO3"], type: "Gas Evolution", severity: "low", description: "Releases CO2 gas; mild effervescence.", action: "Add slowly to avoid overflow." },
  { reagents: ["CH3COOH", "NaOH"], type: "Neutralization", severity: "low", description: "Weak acid-strong base neutralization, mildly exothermic.", action: "Proceed normally; swirl to mix." },
  { reagents: ["H2O2", "MnO2"], type: "Catalytic Decomposition", severity: "medium", description: "MnO2 catalyses rapid decomposition of H2O2, releasing O2 and heat.", action: "Add catalyst in small amounts; expect vigorous bubbling." },
  { reagents: ["H2O2", "H2SO4"], type: "Acidified Oxidiser", severity: "medium", description: "Acidified hydrogen peroxide is a strong oxidiser; concentrated mixtures are hazardous.", action: "Use dilute solutions only; add acid slowly, wear goggles." },
  { reagents: ["KI", "H2O2"], type: "Redox (intended)", severity: "low", description: "Peroxide oxidises iodide to iodine — the intended iodine-clock reaction.", action: "Expected reaction. Mix in ventilation; avoid skin contact." },
  { reagents: ["KMnO4", "HCl"], type: "Toxic Gas Release", severity: "high", description: "KMnO4 + concentrated HCl releases toxic chlorine gas.", action: "STOP. Do not combine. Use a fume hood if unavoidable." },
];

export const CONCENTRATION_WARNINGS: ConcentrationRule[] = [
  { reagent: "HCl", threshold_molarity: 6, severity: "high", message: "Concentrated HCl (>6M) — corrosive, releases fumes. Use a fume hood." },
  { reagent: "H2SO4", threshold_molarity: 6, severity: "high", message: "Concentrated H2SO4 (>6M) — severe burns and dehydration hazard." },
  { reagent: "NaOH", threshold_molarity: 6, severity: "high", message: "Concentrated NaOH (>6M) — caustic, causes severe burns." },
  { reagent: "HNO3", threshold_molarity: 6, severity: "high", message: "Concentrated HNO3 (>6M) — strong oxidizer and corrosive." },
];
