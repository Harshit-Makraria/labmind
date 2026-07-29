/**
 * Physical specifications of the instruments students actually read.
 *
 * These are properties of glassware and gels — not of any model — so they let
 * the server reject readings that are physically impossible regardless of what
 * the vision model reported. A burette has no graduation at 24.37 mL, so no
 * honest reading can ever produce that value.
 */
import "server-only";
import type { VisionCheckType } from "@/lib/types";

export interface InstrumentSpec {
  /** Smallest readable increment. Burettes are read to half a graduation. */
  granularity: number;
  /** Physical range of the scale. */
  min: number;
  max: number;
  unit: string;
  /** Plausible span between a paired initial and final reading, if applicable. */
  plausibleDelta?: { min: number; max: number };
  /** Max spread between replicate runs that still counts as concordant. */
  concordance?: number;
}

const BURETTE_50ML: InstrumentSpec = {
  granularity: 0.05,
  min: 0,
  max: 50,
  unit: "mL",
  // A titre below ~1 mL means the student barely opened the tap; above ~45 mL
  // they have emptied a 50 mL burette, which no standard prep requires.
  plausibleDelta: { min: 1.0, max: 45.0 },
  concordance: 0.1,
};

const GEL_BAND: InstrumentSpec = {
  granularity: 1,
  min: 50,
  max: 20_000,
  unit: "bp",
  concordance: 200,
};

const SPECTROPHOTOMETER: InstrumentSpec = {
  granularity: 0.001,
  // Beer-Lambert linearity breaks down above ~2 AU on a typical classroom
  // spectrophotometer; a reading outside 0-2 means the sample needs dilution
  // or the instrument wasn't blanked, either way not a real absorbance value.
  min: 0,
  max: 2,
  unit: "AU",
};

export function instrumentFor(type: VisionCheckType): InstrumentSpec | null {
  if (type === "burette_reading") return BURETTE_50ML;
  if (type === "gel_band") return GEL_BAND;
  if (type === "absorbance") return SPECTROPHOTOMETER;
  return null; // colour_change has no numeric scale
}
