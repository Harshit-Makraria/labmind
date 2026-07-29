/**
 * The core "check this image" flow.
 *
 * Everything else in the vision pipeline (image-quality.ts's blur/blank gate,
 * image-crop.ts's zoom-to-instrument, vision-ensemble.ts's multi-sample
 * reconciliation, physical-constraints.ts's zero-AI physics check) wraps
 * AROUND this one file. This file does exactly three things, in order, for
 * ONE call to ONE model — nothing else:
 *
 *   ┌────────────────────┐   ┌──────────────────────┐   ┌──────────────────┐
 *   │ 1. BUILD THE       │──▶│ 2. SEND IMAGE +       │──▶│ 3. PARSE THE     │
 *   │    INSTRUCTION      │   │    INSTRUCTION TO     │   │    RESPONSE      │
 *   │    — "what to      │   │    THE VISION MODEL   │   │                  │
 *   │    check" —        │   │                       │   │                  │
 *   └────────────────────┘   └──────────────────────┘   └──────────────────┘
 *
 * vision-ensemble.ts calls runImageCheck() once per sample (possibly against
 * different providers) and reconciles the results; vision.ts calls it after
 * its own pre-flight quality/crop stages. Neither duplicates the prompt text
 * or the provider-calling logic — this file is the single place both do.
 */
import "server-only";
import type { VisionCheckRequest, VisionCheckType } from "@/lib/types";
import { visionWithProvider, type VisionProvider } from "@/server/llm/provider";

export interface ImageCheckObservation {
  reading: number | null;
  graduation_above?: number | null;
  graduation_below?: number | null;
  meniscus_visible?: boolean;
  solution_visible?: boolean;
  scale_legible?: boolean;
  observed_colour?: string;
  colour_intensity?: string;
  confidence?: number;
  message?: string;
  notes?: string;
}

// ── NODE 1 — build the instruction ("what to check in this image") ───────
//
// BLIND READING — the model is never told the expected value. An earlier
// prompt included "the expected reading is approximately X mL" and asked the
// model to confirm it; vision models anchor hard on a number they're handed
// and report it back regardless of the pixels, which is how a 6 mL burette
// got "read" as 24.5 mL with high confidence. The model now reports raw
// observations only — the server (physical-constraints.ts + vision.ts) alone
// decides pass/fail against the tolerance.
export const BLIND_READING_SYSTEM = `You are a forensic instrument reader for a science laboratory.
You report ONLY what is physically visible in the photograph.

Rules:
- You are never told the expected value. Do not guess, infer, or assume what it "should" be.
- Read the instrument exactly as it appears, even if the value seems unusual.
- A value that looks wrong is still the correct answer if that is what the image shows.
- If the scale is unreadable, occluded, or out of focus, return null and a low confidence. Reporting null is a correct, valuable answer — never invent a number to seem helpful.
- Calibrate confidence honestly: 0.9+ only when graduation marks are crisp and unambiguous.
Return valid JSON only — no markdown, no commentary.

Worked examples of correct burette reading technique:
- Meniscus sits two small marks below the printed "24", scale increasing downward,
  minor divisions of 0.1 mL → reading is 24.20, graduation_above 24, graduation_below 25.
- Liquid surface sits exactly on the printed "0" line at the top of the tube
  → reading is 0.00, graduation_above 0, graduation_below 1.
- A clamp covers the scale where the meniscus sits, so the nearest marks cannot be
  counted → reading is null, scale_legible false, confidence 0.2.
Read the BOTTOM of the meniscus curve, not the rim, and note that burette scales
increase downward (0 at the top).`;

const EXPERIMENT_LABELS: Record<string, string> = {
  "acid-base-titration": "Acid-Base Titration (HCl vs NaOH with phenolphthalein indicator)",
  "gel-electrophoresis": "DNA Gel Electrophoresis",
  "iodine-clock": "Iodine Clock Reaction",
  "aur-experiment": "AUR — Absorbance Using a Reference (spectrophotometry)",
};

function experimentLabel(experimentId?: string): string {
  return (experimentId && EXPERIMENT_LABELS[experimentId]) ?? (experimentId ?? "General Lab Experiment");
}

const CHECK_INSTRUCTIONS: Record<VisionCheckType, (baseCtx: string) => string> = {
  burette_reading: (baseCtx) => `${baseCtx}
This photograph shows a burette. Report the liquid level.

Method:
1. Find the liquid surface (meniscus) in the burette tube.
2. Identify the nearest PRINTED number label directly ABOVE the meniscus, and the nearest directly BELOW it.
3. Read the volume at the BOTTOM of the meniscus curve, to the nearest 0.05 mL.
   Note: burette scales increase DOWNWARD (0 at the top).
4. Judge image quality independently of the reading.

Return JSON:
{
  "reading": <number — mL at the bottom of the meniscus, or null if you cannot read it>,
  "graduation_above": <number — the printed label just above the meniscus, or null>,
  "graduation_below": <number — the printed label just below the meniscus, or null>,
  "meniscus_visible": <true|false — is the liquid surface actually visible and unobstructed>,
  "scale_legible": <true|false — are the graduation marks sharp enough to read>,
  "confidence": <0.0–1.0>,
  "message": "<one sentence: what you see and the value you read>",
  "notes": "<if quality is poor, the specific problem — blur, glare, parallax, clamp blocking the scale>"
}`,

  gel_band: (baseCtx) => `${baseCtx}
This photograph shows an agarose gel under UV illumination. Report the band size.

Method:
1. Locate the DNA ladder lane and the student's sample lane.
2. Identify the brightest band in the sample lane.
3. Estimate its size in base pairs by interpolating between the two nearest ladder bands.
4. Judge image quality independently of the reading.

Return JSON:
{
  "reading": <number — estimated bp of the brightest sample band, or null>,
  "graduation_above": <number — bp of the nearest ladder band ABOVE (larger), or null>,
  "graduation_below": <number — bp of the nearest ladder band BELOW (smaller), or null>,
  "meniscus_visible": <true|false — is a distinct band actually visible>,
  "scale_legible": <true|false — is the ladder readable>,
  "confidence": <0.0–1.0>,
  "message": "<one sentence describing the lanes and bands you see>",
  "notes": "<specific quality problem if any — overexposure, smearing, no ladder>"
}`,

  absorbance: (baseCtx) => `${baseCtx}
This photograph shows a spectrophotometer's digital display after a sample reading.

Method:
1. Locate the absorbance value on the display (may be labeled "A" or "Abs").
2. Read the full displayed value, including all decimal places shown.
3. Judge image quality independently of the reading.

Return JSON:
{
  "reading": <number — the displayed absorbance in AU, or null if you cannot read the display>,
  "graduation_above": null,
  "graduation_below": null,
  "meniscus_visible": <true|false — is the display actually visible and unobstructed>,
  "scale_legible": <true|false — are the digits sharp enough to read>,
  "confidence": <0.0–1.0>,
  "message": "<one sentence: what you see and the value you read>",
  "notes": "<if quality is poor, the specific problem — glare on the screen, blur, wrong display mode>"
}`,

  colour_change: (baseCtx) => `${baseCtx}
This photograph shows a reaction mixture in a flask or beaker.

Report the colour you actually observe FIRST, before making any judgement.

Return JSON:
{
  "reading": null,
  "observed_colour": "<the colour you actually see, in plain words>",
  "colour_intensity": "<none|faint|moderate|deep>",
  "solution_visible": <true|false — is the liquid clearly visible>,
  "scale_legible": <true|false — is lighting adequate to judge colour>,
  "confidence": <0.0–1.0 — how sure you are of the colour you named>,
  "message": "<one sentence describing what is in the vessel>",
  "notes": "<lighting or clarity problems if any>"
}`,
};

/** NODE 1 — build the per-instrument "what to check" message for this step. */
export function buildCheckInstruction(req: Pick<VisionCheckRequest, "expected" | "step_number" | "experiment_id">): string {
  const { expected, step_number, experiment_id } = req;
  const baseCtx = `Experiment: ${experimentLabel(experiment_id)}. Step: ${step_number}.`;
  const build = CHECK_INSTRUCTIONS[expected.type];
  if (build) return build(baseCtx);

  return `${baseCtx}
Report what is physically visible in this laboratory photograph.

Return JSON:
{
  "reading": <number if an instrument value is visible, else null>,
  "scale_legible": <true|false>,
  "confidence": <0.0–1.0>,
  "message": "<what you observe in one sentence>",
  "notes": "<image quality problems if any>"
}`;
}

/** NODE 2 — send the image + instruction to one specific vision model. */
export function sendImageToModel(
  provider: VisionProvider,
  instruction: string,
  imageBase64: string,
  temperature?: number,
): Promise<string> {
  return visionWithProvider(provider, BLIND_READING_SYSTEM, { imageBase64, prompt: instruction }, { temperature });
}

/** NODE 3 — parse the model's raw text response into structured data. */
export function parseImageCheckResponse(raw: string): ImageCheckObservation | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    return JSON.parse(cleaned) as ImageCheckObservation;
  } catch {
    return null;
  }
}

/** Runs all three nodes, in order, for ONE sample from ONE provider. */
export async function runImageCheck(
  provider: VisionProvider,
  req: Pick<VisionCheckRequest, "expected" | "step_number" | "experiment_id">,
  imageBase64: string,
  temperature?: number,
): Promise<ImageCheckObservation | null> {
  const instruction = buildCheckInstruction(req);              // 1. build
  const raw = await sendImageToModel(provider, instruction, imageBase64, temperature); // 2. send
  return parseImageCheckResponse(raw);                          // 3. parse
}
