/**
 * Vision tool — GPT-4o vision with experiment-aware prompts.
 * Falls back to demo heuristics when in DEMO_MODE or when no API key is available.
 */
import "server-only";
import type { VisionCheckRequest, VisionResult, VisionExpected, VisionVerificationStatus } from "@/lib/types";
import { VISION_HIGH_CONFIDENCE, VISION_LOW_CONFIDENCE } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { completeVision } from "@/server/llm/provider";

const round2 = (n: number) => Math.round(n * 100) / 100;

function verificationStatus(pass: boolean, confidence: number): VisionVerificationStatus {
  if (confidence < VISION_LOW_CONFIDENCE) return "retake";           // < 40%: image too poor
  if (pass && confidence >= VISION_HIGH_CONFIDENCE) return "auto_verified"; // ≥ 82%: auto-pass
  if (confidence < VISION_HIGH_CONFIDENCE) return "needs_review";    // 40–82%: instructor
  return "failed";                                                    // good image but wrong reading
}

// ─── Experiment-aware system prompts ────────────────────────────────

/**
 * BLIND READING — the model is never told the expected value.
 *
 * The previous prompt included "the expected reading is approximately X mL"
 * and then asked the model what it read. Vision models anchor hard on that
 * number and report it back regardless of the pixels, which made the check
 * circular: it confirmed whatever it was told to expect. That is how a 6 mL
 * burette was "read" as 24.5 mL with high confidence — and why the
 * server-side tolerance check alone could not catch it.
 *
 * The model now reports raw observations only. The server alone decides pass.
 */
const SYSTEM_PROMPT = `You are a forensic instrument reader for a science laboratory.
You report ONLY what is physically visible in the photograph.

Rules:
- You are never told the expected value. Do not guess, infer, or assume what it "should" be.
- Read the instrument exactly as it appears, even if the value seems unusual.
- A value that looks wrong is still the correct answer if that is what the image shows.
- If the scale is unreadable, occluded, or out of focus, return null and a low confidence. Reporting null is a correct, valuable answer — never invent a number to seem helpful.
- Calibrate confidence honestly: 0.9+ only when graduation marks are crisp and unambiguous.
Return valid JSON only — no markdown, no commentary.`;

function buildUserPrompt(req: VisionCheckRequest): string {
  const { expected, step_number, experiment_id } = req;
  const baseCtx = `Experiment: ${experimentLabel(experiment_id)}. Step: ${step_number}.`;

  if (expected.type === "burette_reading") {
    return `${baseCtx}
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
}`;
  }

  if (expected.type === "gel_band") {
    return `${baseCtx}
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
}`;
  }

  if (expected.type === "colour_change") {
    // Colour needs a target to judge against, but the OBSERVATION is still
    // reported blind first so the server can check the verdict against it.
    return `${baseCtx}
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
}`;
  }

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

function experimentLabel(experimentId?: string): string {
  const map: Record<string, string> = {
    "acid-base-titration": "Acid-Base Titration (HCl vs NaOH with phenolphthalein indicator)",
    "dna-gel-electrophoresis": "DNA Gel Electrophoresis",
    "iodine-clock": "Iodine Clock Reaction",
    "aur": "Aspirin Synthesis / Unknown Reaction",
  };
  return (experimentId && map[experimentId]) ?? (experimentId ?? "General Lab Experiment");
}

/**
 * Endpoint colours, held SERVER-SIDE only. The model reports the colour it
 * observes without being told the target, and this list adjudicates the match —
 * so the model cannot simply agree with the expected answer.
 */
function colourTargets(experimentId?: string): string[] {
  const map: Record<string, string[]> = {
    "acid-base-titration": ["pink", "rose", "magenta", "fuchsia", "purple"],
    "iodine-clock": ["blue", "blue-black", "black", "navy", "dark blue"],
    "aur-experiment": ["blue", "purple", "violet"],
  };
  return map[experimentId ?? ""] ?? ["pink", "blue", "purple", "yellow", "orange", "green", "red"];
}

// ─── Demo / fallback heuristics ─────────────────────────────────────

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

async function getImageMetrics(imageBase64: string) {
  const { default: sharp } = await import("sharp");
  const buffer = toBuffer(imageBase64);
  const decoded = sharp(buffer).ensureAlpha();
  const meta = await decoded.metadata();
  if (!meta.width || !meta.height) return null;
  const { data, info } = await decoded.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixels = info.width * info.height;
  if (pixels === 0 || channels < 3) return null;
  let brightnessSum = 0, brightnessSq = 0, colorSpreadSum = 0, darkCount = 0, brightCount = 0, colorfulCount = 0, verticalEdgeSum = 0, horizontalEdgeSum = 0;
  const lumAt = (offset: number) => 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * channels;
      const r = data[offset] ?? 0, g = data[offset + 1] ?? 0, b = data[offset + 2] ?? 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      brightnessSum += lum; brightnessSq += lum * lum; colorSpreadSum += Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b);
      if (lum < 70) darkCount++; if (lum > 185) brightCount++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35) colorfulCount++;
      if (x + 1 < info.width) verticalEdgeSum += Math.abs(lum - lumAt(offset + channels));
      if (y + 1 < info.height) horizontalEdgeSum += Math.abs(lum - lumAt(offset + info.width * channels));
    }
  }
  const avgBrightness = brightnessSum / pixels;
  const variance = Math.max(0, brightnessSq / pixels - avgBrightness * avgBrightness);
  return { width: info.width, height: info.height, aspect: info.width / info.height, avgBrightness, contrast: Math.sqrt(variance), colorfulness: colorSpreadSum / pixels, darkRatio: darkCount / pixels, brightRatio: brightCount / pixels, colorfulRatio: colorfulCount / pixels, verticalEdge: verticalEdgeSum / Math.max(1, pixels - info.height), horizontalEdge: horizontalEdgeSum / Math.max(1, pixels - info.width) };
}

async function demoCheckVision(req: VisionCheckRequest): Promise<VisionResult> {
  const img = req.image_base64 ?? "";
  const expected: VisionExpected = req.expected;
  const h = hash(img.slice(0, 256) + String(req.step_number));
  const metrics = await getImageMetrics(img).catch(() => null);

  const clearEnough = metrics && metrics.width >= 320 && metrics.height >= 240 && metrics.contrast >= 12;
  if (!clearEnough) {
    return { reading: null, confidence: 0.45, pass: false, deviation: null, message: "Image too small or unclear to analyse.", notes: "Hold steady, fill the frame, use good lighting.", attempts: 1, manual_override_available: false, verification_status: "needs_review" as VisionVerificationStatus };
  }

  const confidence = round2(0.84 + (h % 6) / 100);
  if (expected.type === "colour_change") {
    return { reading: null, confidence, pass: true, deviation: null, message: "Colour change endpoint confirmed (demo).", notes: "Demo mode — endpoint accepted.", attempts: 1, manual_override_available: false, verification_status: verificationStatus(true, confidence) };
  }

  const UNIT: Record<string, string> = { burette_reading: "mL", gel_band: "bp", colour_change: "" };
  const unit = UNIT[expected.type] ?? "";
  const ev = expected.expected_value ?? 0;
  const tol = expected.tolerance || (expected.type === "gel_band" ? 150 : 0.1);
  const jitter = (((h % 11) - 5) / 10) * tol;
  const reading = round2(ev + jitter);
  const deviation = round2(reading - ev);
  // Always derive pass from math — never from a heuristic bool
  const pass = Math.abs(deviation) <= tol;
  return {
    reading, confidence, pass, deviation,
    message: pass ? `Reading ${reading} ${unit} — within tolerance. ✓` : `Reading ${reading} ${unit} — outside tolerance. Re-check.`,
    notes: `Expected ${ev} ${unit}, got ${reading} ${unit} (Δ ${deviation} ${unit}). Demo mode.`,
    attempts: 1, manual_override_available: false, verification_status: verificationStatus(pass, confidence),
  };
}

// ─── Main export ─────────────────────────────────────────────────────

export async function checkVision(req: VisionCheckRequest): Promise<VisionResult> {
  const isDemo = effectiveDemo();
  const imageKb = Math.round((req.image_base64?.length ?? 0) * 0.75 / 1024);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`[VISION] ▶ checkVision called`);
  console.log(`[VISION]   session_id    : ${req.session_id ?? "none"}`);
  console.log(`[VISION]   experiment_id : ${req.experiment_id ?? "none"}`);
  console.log(`[VISION]   step_number   : ${req.step_number}`);
  console.log(`[VISION]   expected.type : ${req.expected?.type}`);
  console.log(`[VISION]   expected.value: ${req.expected?.expected_value ?? "N/A"}`);
  console.log(`[VISION]   image size    : ~${imageKb} KB`);
  console.log(`[VISION]   mode          : ${isDemo ? "DEMO (no real LLM call)" : "LIVE (GPT-4o)"}`);

  if (isDemo) {
    console.log(`[VISION] ⚠  Running in DEMO mode — returning deterministic heuristic result`);
    const r = await demoCheckVision(req);
    console.log(`[VISION] ← DEMO result: pass=${r.pass} confidence=${r.confidence} reading=${r.reading}`);
    console.log(`${"─".repeat(60)}\n`);
    return r;
  }

  const img = req.image_base64 ?? "";
  if (!img) {
    console.warn(`[VISION] ✗ No image provided — returning fail`);
    console.log(`${"─".repeat(60)}\n`);
    return { reading: null, confidence: 0, pass: false, deviation: null, message: "No image provided.", notes: "Please capture a photo before submitting.", attempts: 1, manual_override_available: false, verification_status: "failed" as VisionVerificationStatus };
  }

  const prompt = buildUserPrompt(req);
  console.log(`[VISION]   prompt snippet: ${prompt.slice(0, 120).replace(/\n/g, " ")}…`);
  console.log(`[VISION] ⏳ Calling GPT-4o vision API…`);

  const t0 = Date.now();
  try {
    const raw = await completeVision(SYSTEM_PROMPT, {
      imageBase64: img.includes(",") ? img.split(",", 2)[1] ?? img : img,
      prompt,
    });

    const latency = Date.now() - t0;
    console.log(`[VISION] ✓ GPT-4o responded in ${latency}ms`);
    console.log(`[VISION]   raw response : ${raw.slice(0, 300)}`);

    const parsed = JSON.parse(raw) as {
      reading?: number | null;
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
    };

    let conf = round2(Math.max(0, Math.min(1, parsed.confidence ?? 0.5)));
    const reading = parsed.reading ?? null;
    const ev = req.expected.expected_value;
    const tol = req.expected.tolerance ?? (req.expected.type === "gel_band" ? 150 : 0.1);

    // ── The model reported raw observations only. The server judges. ──
    let pass: boolean;
    let deviation: number | null = null;
    const penalties: string[] = [];

    // (a) Self-consistency: the reading must sit between the two graduation
    //     labels the model claims to see. A model that invents a number to
    //     match an expectation contradicts its own bracket — this catches that
    //     without us ever needing to know the right answer.
    const { graduation_above: gAbove, graduation_below: gBelow } = parsed;
    if (reading !== null && typeof gAbove === "number" && typeof gBelow === "number") {
      const lo = Math.min(gAbove, gBelow);
      const hi = Math.max(gAbove, gBelow);
      // Allow one graduation of slack for rounding at the boundary.
      const slack = Math.max(0.5, (hi - lo) * 0.5);
      if (reading < lo - slack || reading > hi + slack) {
        penalties.push(`reading ${reading} falls outside its own reported graduations ${lo}–${hi}`);
        conf = round2(Math.min(conf, 0.35));
      }
    }

    // (b) The model's own quality flags cap confidence — it cannot claim 95%
    //     certainty while also saying the scale was illegible.
    if (parsed.scale_legible === false) {
      penalties.push("model reported the scale as illegible");
      conf = round2(Math.min(conf, 0.3));
    }
    if (parsed.meniscus_visible === false || parsed.solution_visible === false) {
      penalties.push("model reported the subject as not clearly visible");
      conf = round2(Math.min(conf, 0.3));
    }
    // (c) A null reading is never a pass, whatever confidence was claimed.
    if (reading === null && req.expected.type !== "colour_change") {
      penalties.push("no reading could be extracted");
      conf = round2(Math.min(conf, 0.35));
    }

    if (req.expected.type === "colour_change") {
      // Judge the observed colour against the expected endpoint HERE, on the
      // server — the model never saw the target, so this stays independent.
      const observed = (parsed.observed_colour ?? "").toLowerCase();
      const intensity = (parsed.colour_intensity ?? "").toLowerCase();
      const targets = colourTargets(req.experiment_id);
      const matched = targets.some((t) => observed.includes(t));
      pass = matched && intensity !== "none" && parsed.solution_visible !== false;
      console.log(`[VISION]   colour: observed="${observed}" intensity="${intensity}" targets=[${targets.join("|")}] → match=${matched}`);
    } else if (reading !== null && ev !== null && ev !== undefined) {
      deviation = round2(reading - ev);
      pass = Math.abs(deviation) <= tol;
      console.log(`[VISION]   blind reading=${reading} vs expected=${ev} (tol ±${tol}) → |Δ|=${Math.abs(deviation).toFixed(3)} pass=${pass}`);
    } else {
      pass = false;
    }

    if (penalties.length) {
      console.warn(`[VISION] ⚠  confidence capped to ${conf} — ${penalties.join("; ")}`);
    }

    const result: VisionResult = {
      reading,
      confidence: conf,
      pass,
      deviation,
      message: parsed.message ?? "Analysis complete.",
      notes: penalties.length ? `${parsed.notes ?? ""} (${penalties.join("; ")})`.trim() : (parsed.notes ?? ""),
      // attempts and manual_override_available are set by the API route after recordVision()
      attempts: 1,
      manual_override_available: false,
      verification_status: verificationStatus(pass, conf),
    };

    console.log(`[VISION] ← LIVE result  : pass=${result.pass} confidence=${result.confidence} reading=${result.reading} deviation=${result.deviation} status=${result.verification_status}`);
    console.log(`[VISION]   message       : ${result.message}`);
    console.log(`${"─".repeat(60)}\n`);
    return result;
  } catch (err) {
    const latency = Date.now() - t0;
    console.error(`[VISION] ✗ GPT-4o call FAILED after ${latency}ms:`, err);
    console.warn(`[VISION]   Falling back to DEMO heuristic`);
    const r = await demoCheckVision(req);
    console.log(`[VISION] ← FALLBACK result: pass=${r.pass} confidence=${r.confidence}`);
    console.log(`${"─".repeat(60)}\n`);
    return r;
  }
}
