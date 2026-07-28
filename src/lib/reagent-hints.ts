/**
 * Client-safe hazard hints, keyed by the reagent names actually used across
 * the experiment library. Deliberately small and specific rather than a
 * generic "wear PPE" — each entry is real handling guidance for that reagent,
 * not decoration. Falls back to a generic caution line for anything unlisted.
 */
export interface ReagentHint {
  hazard: string;
  action: string;
  severity: "low" | "medium" | "high";
}

export const REAGENT_HINTS: Record<string, ReagentHint> = {
  HCl: { hazard: "Corrosive", action: "Causes skin burns and serious eye damage. Wear goggles and nitrile gloves. On contact, flood with cold water for 15 minutes and tell your instructor.", severity: "high" },
  NaOH: { hazard: "Corrosive", action: "Caustic — causes severe burns on contact. Goggles and gloves required. Never touch bare skin; flush immediately with water if exposed.", severity: "high" },
  H2SO4: { hazard: "Corrosive", action: "Severe burn and dehydration hazard. Always add acid to water, never the reverse. Full PPE required.", severity: "high" },
  H2O2: { hazard: "Oxidizer", action: "Bleaches skin and irritates on contact. Keep away from organic solvents and metals. Rinse any spill immediately.", severity: "medium" },
  KI: { hazard: "Mild irritant", action: "Low hazard at working concentration. Avoid ingestion; wash hands after handling.", severity: "low" },
  Na2S2O3: { hazard: "Mild irritant", action: "Low hazard. Avoid prolonged skin contact; rinse if exposed.", severity: "low" },
  phenolphthalein: { hazard: "Indicator dye", action: "Avoid ingestion and eye contact. A few drops only — it stains skin and clothing.", severity: "low" },
  starch: { hazard: "Low hazard", action: "No special precautions beyond standard lab hygiene.", severity: "low" },
  agarose: { hazard: "Hot when molten", action: "Melted agarose causes burns — handle with care until fully cooled and set.", severity: "medium" },
  "TAE buffer": { hazard: "Mild irritant", action: "Avoid eye contact. Wash hands after handling.", severity: "low" },
  "loading dye": { hazard: "Mild irritant", action: "Avoid skin and eye contact; wash off if exposed.", severity: "low" },
  "SYBR Safe": { hazard: "Mutagen (mild)", action: "Wear gloves — avoid skin contact. Do not pipette by mouth.", severity: "medium" },
  "DNA ladder": { hazard: "Low hazard", action: "No special precautions; standard lab hygiene.", severity: "low" },
};

export function hintFor(name: string): ReagentHint {
  return (
    REAGENT_HINTS[name] ?? {
      hazard: "Unclassified",
      action: "No specific hazard data on file for this reagent — follow your lab's general PPE policy and ask your instructor if unsure.",
      severity: "low",
    }
  );
}
