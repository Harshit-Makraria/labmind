/**
 * Vision tool — GPT-4o vision with experiment-aware prompts.
 * Falls back to demo heuristics when in DEMO_MODE or when no API key is available.
 */
import "server-only";
import type { VisionCheckRequest, VisionResult, VisionExpected } from "@/lib/types";
import { effectiveDemo } from "@/server/config";
import { completeVision } from "@/server/llm/provider";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── Experiment-aware system prompts ────────────────────────────────

const SYSTEM_PROMPT = `You are a lab assistant AI that analyses student photographs from real chemistry and biology experiments.
You will receive an image and return a JSON object describing what you see.
Be precise, concise, and calibrated — never hallucinate a reading. If you cannot read a value, set confidence < 0.6 and pass: false.
Always return valid JSON only — no markdown, no extra text.`;

function buildUserPrompt(req: VisionCheckRequest): string {
  const { expected, step_number, experiment_id } = req;
  const expLabel = experimentLabel(experiment_id);

  const baseCtx = `Experiment: ${expLabel}. Step: ${step_number}.`;

  if (expected.type === "burette_reading") {
    const ev = expected.expected_value ?? "unknown";
    const tol = expected.tolerance ?? 0.1;
    return `${baseCtx}
The student has photographed a burette after a titration.

Your task:
1. Locate the burette meniscus in the image.
2. Read the volume at the BOTTOM of the meniscus to the nearest 0.05 mL.
3. The expected reading is approximately ${ev} mL ± ${tol} mL.
4. Assess image quality: is the burette in focus, fully visible, well-lit, and free from parallax angle?

Return JSON:
{
  "reading": <number — the mL value you read, or null if unreadable>,
  "confidence": <0.0–1.0 — how certain you are of the reading>,
  "pass": <true if reading is within ±${tol} mL of ${ev}, false otherwise>,
  "deviation": <reading minus ${ev}, or null>,
  "message": "<one sentence describing what you see and the reading>",
  "notes": "<practical tip for the student if confidence is low or pass is false, otherwise 'Good technique — reading confirmed.'>"
}`;
  }

  if (expected.type === "gel_band") {
    const ev = expected.expected_value ?? "unknown";
    const tol = expected.tolerance ?? 150;
    return `${baseCtx}
The student has photographed an agarose gel electrophoresis result under UV light.

Your task:
1. Identify the DNA band(s) in the student's lane.
2. Estimate the size of the brightest/most prominent band in base pairs (bp) using the ladder bands visible on the gel.
3. The expected band size is approximately ${ev} bp ± ${tol} bp.
4. Assess image quality: is the gel visible under UV, are the bands distinct, is the ladder readable?

Return JSON:
{
  "reading": <number — estimated bp of the target band, or null if unreadable>,
  "confidence": <0.0–1.0>,
  "pass": <true if reading is within ±${tol} bp of ${ev}, false otherwise>,
  "deviation": <reading minus ${ev}, or null>,
  "message": "<one sentence describing the gel bands you see>",
  "notes": "<tip if confidence is low or pass is false, otherwise 'Band size confirmed within tolerance.'>"
}`;
  }

  if (expected.type === "colour_change") {
    const expObs = colourChangeDescription(experiment_id);
    return `${baseCtx}
The student has photographed the reaction mixture at the claimed endpoint.

Your task:
1. Identify the colour of the solution in the flask/beaker.
2. Determine whether the expected endpoint colour change has occurred: ${expObs}
3. Is the colour change permanent (has the student left it at least 30 seconds) or did it flash and fade?
4. Assess image quality: is the solution clearly visible and in good lighting?

Return JSON:
{
  "reading": null,
  "confidence": <0.0–1.0>,
  "pass": <true if the expected colour change is clearly visible and appears permanent>,
  "deviation": null,
  "message": "<one sentence describing the colour you observe>",
  "notes": "<tip if confidence is low or the endpoint is not reached, otherwise 'Endpoint colour confirmed.'>"
}`;
  }

  // Generic fallback
  return `${baseCtx}
Analyse this lab photo and verify whether the student has completed the step correctly.
Expected observation: type=${expected.type}, value=${expected.expected_value ?? "N/A"}, tolerance=±${expected.tolerance}.

Return JSON:
{
  "reading": <number or null>,
  "confidence": <0.0–1.0>,
  "pass": <true or false>,
  "deviation": <number or null>,
  "message": "<what you observe in one sentence>",
  "notes": "<feedback for the student>"
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

function colourChangeDescription(experimentId?: string): string {
  const map: Record<string, string> = {
    "acid-base-titration": "The solution should change from colourless to a persistent pale pink/faint purple (phenolphthalein endpoint). A deep pink means you overshot.",
    "iodine-clock": "The solution should turn suddenly from colourless to a deep blue-black colour (starch-iodine complex).",
    "aur": "Check for the colour change described in your protocol.",
  };
  return map[experimentId ?? ""] ?? "A clear, visible colour change should be present.";
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
    return { reading: null, confidence: 0.45, pass: false, deviation: null, message: "Image too small or unclear to analyse.", notes: "Hold steady, fill the frame, use good lighting.", attempts: 1, manual_override_available: false };
  }

  const confidence = round2(0.84 + (h % 6) / 100);
  if (expected.type === "colour_change") {
    return { reading: null, confidence, pass: true, deviation: null, message: "Colour change endpoint confirmed (demo).", notes: "Demo mode — endpoint accepted.", attempts: 1, manual_override_available: false };
  }

  const UNIT: Record<string, string> = { burette_reading: "mL", gel_band: "bp", colour_change: "" };
  const unit = UNIT[expected.type] ?? "";
  const ev = expected.expected_value ?? 0;
  const tol = expected.tolerance || (expected.type === "gel_band" ? 150 : 0.1);
  const jitter = (((h % 11) - 5) / 10) * tol;
  const reading = round2(ev + jitter);
  const deviation = round2(reading - ev);
  const pass = Math.abs(deviation) <= tol;
  return {
    reading, confidence, pass, deviation,
    message: pass ? `Reading ${reading} ${unit} — within tolerance. ✓` : `Reading ${reading} ${unit} — outside tolerance. Re-check.`,
    notes: `Expected ${ev} ${unit}, got ${reading} ${unit} (Δ ${deviation} ${unit}). Demo mode.`,
    attempts: 1, manual_override_available: false,
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
    return { reading: null, confidence: 0, pass: false, deviation: null, message: "No image provided.", notes: "Please capture a photo before submitting.", attempts: 1, manual_override_available: false };
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
      confidence?: number;
      pass?: boolean;
      deviation?: number | null;
      message?: string;
      notes?: string;
    };

    const result: VisionResult = {
      reading: parsed.reading ?? null,
      confidence: round2(Math.max(0, Math.min(1, parsed.confidence ?? 0.5))),
      pass: parsed.pass ?? false,
      deviation: parsed.deviation ?? null,
      message: parsed.message ?? "Analysis complete.",
      notes: parsed.notes ?? "",
      // attempts and manual_override_available are set by the API route after recordVision()
      attempts: 1,
      manual_override_available: false,
    };

    console.log(`[VISION] ← LIVE result  : pass=${result.pass} confidence=${result.confidence} reading=${result.reading} deviation=${result.deviation}`);
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
