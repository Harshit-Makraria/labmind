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
  /** "descriptive" checks — what the model actually saw, before any judgement. */
  observed_description?: string;
  /** Which of the instructor's must_show criteria the model found present. */
  criteria_present?: string[];
  /** Which must_show criteria are missing — the reason a step fails. */
  criteria_missing?: string[];
  /** Which must_not_show criteria were (wrongly) observed. */
  criteria_violated?: string[];
  /** Whether the subject of the step is visible at all. */
  subject_visible?: boolean;
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

/** The hand-tuned instrument readers. "descriptive" is deliberately absent — it
 *  is built from the instructor's own description in buildDescriptiveInstruction. */
const CHECK_INSTRUCTIONS: Partial<Record<VisionCheckType, (baseCtx: string) => string>> = {
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

/**
 * The universal check. Instead of a hardcoded instrument prompt, the
 * instructor's own description of the required evidence drives the check.
 *
 * The blind-reading discipline is preserved in the way that matters: the model
 * is asked to DESCRIBE what it sees before it judges anything, and it is never
 * told the expected numeric value even when one exists. It reports which
 * criteria it observed; the SERVER decides pass/fail from that. Handing the
 * model the target number is what previously caused a 6 mL burette to be
 * "read" as 24.5 mL, and that mistake is not repeated here.
 */
function buildDescriptiveInstruction(baseCtx: string, expected: VisionCheckRequest["expected"]): string {
  const description = expected.description?.trim() || "the apparatus and result described by this step";
  const mustShow = expected.must_show?.filter(Boolean) ?? [];
  const mustNotShow = expected.must_not_show?.filter(Boolean) ?? [];
  const wantsNumber = expected.expected_value !== null && expected.expected_value !== undefined;

  return `${baseCtx}
A student has submitted this photograph as evidence for a laboratory step.

WHAT THIS STEP REQUIRES THE PHOTO TO SHOW:
"${description}"

${mustShow.length ? `Required features — check each one independently:\n${mustShow.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n` : ""}${mustNotShow.length ? `Problems to watch for — report any you actually see:\n${mustNotShow.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}\n` : ""}
Method:
1. FIRST describe exactly what is visible in the photograph, in plain words.
   Do this before judging anything.
2. Then decide which required features are genuinely present, and which are
   missing. Judge only from the pixels — do not assume a feature is present
   because the step says it should be.
3. ${wantsNumber ? "If a numeric value is displayed on an instrument, scale or screen, report it exactly as shown." : "If any numeric value happens to be visible, report it; otherwise return null."}
4. Judge image quality independently of the content.

If the photo does not show the subject at all (wrong subject, covered lens,
unrelated image), set subject_visible false and confidence low. Reporting that
honestly is a correct and valuable answer — never approve a photo to be helpful.

Return JSON:
{
  "observed_description": "<what you actually see, plainly, 1–2 sentences>",
  "criteria_present": [<the required features you genuinely observed, as strings>],
  "criteria_missing": [<required features you cannot confirm from this image>],
  "criteria_violated": [<problems from the watch-for list you actually see>],
  "subject_visible": <true|false — is the step's subject actually in frame>,
  "reading": <number if a value is legibly displayed, else null>,
  "scale_legible": <true|false — is the image clear enough to judge>,
  "confidence": <0.0–1.0 — 0.9+ only when the image is unambiguous>,
  "message": "<one sentence stating whether the evidence supports this step>",
  "notes": "<specific quality problems: blur, glare, framing, occlusion>"
}`;
}

/** NODE 1 — build the per-instrument "what to check" message for this step. */
export function buildCheckInstruction(req: Pick<VisionCheckRequest, "expected" | "step_number" | "experiment_id">): string {
  const { expected, step_number, experiment_id } = req;
  const baseCtx = `Experiment: ${experimentLabel(experiment_id)}. Step: ${step_number}.`;

  // A description always wins, even if the step also declares a legacy type —
  // an instructor who wrote what the photo must show has said something more
  // specific than any generic instrument template can express.
  if (expected.type === "descriptive" || expected.description?.trim()) {
    return buildDescriptiveInstruction(baseCtx, expected);
  }

  const build = CHECK_INSTRUCTIONS[expected.type];
  if (build) return build(baseCtx);

  // Unknown type with no description — fall back to the generic path rather
  // than a bare "describe this", so the step is still meaningfully judged.
  return buildDescriptiveInstruction(baseCtx, expected);
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
