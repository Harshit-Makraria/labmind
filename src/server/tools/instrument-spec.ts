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
  /**
   * Smallest readable increment, for instruments with real fixed graduation
   * marks — a burette has a physical line every 0.1 mL, so a reading between
   * marks is genuinely impossible. Omitted for instruments with no such
   * marks: a gel band's size is read by log-linear interpolation against a
   * ladder, so a value that falls *between* ladder rungs is the normal,
   * expected case, not a violation — there is no fixed increment to snap to.
   */
  granularity?: number;
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
  // No granularity: unlike a burette's fixed graduation marks, a gel band's
  // size comes from interpolating its migration distance against a ladder on
  // a log scale — landing between two ladder rungs (e.g. 1200 bp, between the
  // 1000 and 1500 rungs) is the ordinary, expected outcome of that method, not
  // evidence the model invented a value. Claiming a fake granularity here
  // would flag normal readings as "impossible" while never catching the
  // failure mode that's actually real for gels: a size outside the range this
  // agarose concentration can resolve (below), or wildly discordant repeats
  // (concordance below).
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
