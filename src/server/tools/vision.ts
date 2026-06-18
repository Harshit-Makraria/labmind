/**
 * Vision tool (Feature 2) — verify a captured photo against the expected reading.
 *
 * DEMO_MODE simulates a multimodal reading deterministically from the image so the
 * demo is reproducible across all experiment types: a real captured photo passes
 * with a value inside tolerance; a tiny/blank image returns low confidence →
 * "re-photograph". Attempt counting + manual-override gating are applied by the
 * route using the session store.
 */
import "server-only";
import type { VisionCheckRequest, VisionResult, VisionExpected } from "@/lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const UNIT: Record<VisionExpected["type"], string> = {
  burette_reading: "mL",
  gel_band: "bp",
  colour_change: "",
};

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
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

  let brightnessSum = 0;
  let brightnessSq = 0;
  let colorSpreadSum = 0;
  let darkCount = 0;
  let brightCount = 0;
  let colorfulCount = 0;
  let verticalEdgeSum = 0;
  let horizontalEdgeSum = 0;

  const lumAt = (offset: number) => {
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * channels;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      brightnessSum += lum;
      brightnessSq += lum * lum;
      colorSpreadSum += Math.abs(r - g) + Math.abs(r - b) + Math.abs(g - b);
      if (lum < 70) darkCount += 1;
      if (lum > 185) brightCount += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 35) colorfulCount += 1;

      if (x + 1 < info.width) {
        verticalEdgeSum += Math.abs(lum - lumAt(offset + channels));
      }
      if (y + 1 < info.height) {
        horizontalEdgeSum += Math.abs(lum - lumAt(offset + info.width * channels));
      }
    }
  }

  const avgBrightness = brightnessSum / pixels;
  const variance = Math.max(0, brightnessSq / pixels - avgBrightness * avgBrightness);
  const contrast = Math.sqrt(variance);
  return {
    width: info.width,
    height: info.height,
    aspect: info.width / info.height,
    avgBrightness,
    contrast,
    colorfulness: colorSpreadSum / pixels,
    darkRatio: darkCount / pixels,
    brightRatio: brightCount / pixels,
    colorfulRatio: colorfulCount / pixels,
    verticalEdge: verticalEdgeSum / Math.max(1, pixels - info.height),
    horizontalEdge: horizontalEdgeSum / Math.max(1, pixels - info.width),
  };
}

function structureScore(expected: VisionExpected["type"], metrics: Awaited<ReturnType<typeof getImageMetrics>>) {
  if (!metrics) return { ok: false, score: 0, reason: "Image could not be decoded." };

  const clearEnough = metrics.width >= 320 && metrics.height >= 240 && metrics.contrast >= 12;
  if (!clearEnough) return { ok: false, score: 0.1, reason: "Image is too small or flat to analyze reliably." };

  if (expected === "burette_reading") {
    const ok = metrics.aspect <= 1.45 && metrics.aspect >= 0.55 && metrics.verticalEdge >= metrics.horizontalEdge * 1.03 && metrics.brightRatio >= 0.18;
    const score = [metrics.verticalEdge / Math.max(1, metrics.horizontalEdge), metrics.brightRatio * 3, Math.max(0, 1.6 - Math.abs(metrics.aspect - 1))].reduce((a, b) => a + b, 0) / 5;
    return { ok, score, reason: ok ? "Looks like a tall lab reading capture." : "Does not resemble a burette-style reading image." };
  }

  if (expected === "gel_band") {
    const ok = metrics.aspect >= 1.1 && metrics.horizontalEdge >= metrics.verticalEdge * 1.03 && metrics.darkRatio >= 0.08;
    const score = [metrics.horizontalEdge / Math.max(1, metrics.verticalEdge), metrics.darkRatio * 4, Math.min(metrics.aspect / 1.8, 2)].reduce((a, b) => a + b, 0) / 5;
    return { ok, score, reason: ok ? "Looks like a gel lane/band capture." : "Does not resemble a gel band image." };
  }

  const ok = metrics.colorfulness >= 12 && metrics.contrast >= 10 && metrics.colorfulRatio >= 0.1;
  const score = [metrics.colorfulness / 30, metrics.contrast / 20, metrics.colorfulRatio * 2].reduce((a, b) => a + b, 0) / 3;
  return { ok, score, reason: ok ? "A strong color shift is visible." : "Does not resemble a clear colour-change endpoint." };
}

/** Core reading. `attempts`/`manual_override_available` are placeholders set by the route. */
export async function checkVision(req: VisionCheckRequest): Promise<VisionResult> {
  const img = req.image_base64 ?? "";
  const expected: VisionExpected = req.expected;
  const h = hash(img.slice(0, 256) + String(req.step_number));
  const metrics = await getImageMetrics(img).catch(() => null);
  const structure = structureScore(expected.type, metrics);

  if (!structure.ok) {
    return {
      reading: null,
      confidence: round2(Math.max(0.35, Math.min(0.78, 0.45 + structure.score * 0.2))),
      pass: false,
      deviation: null,
      message: structure.reason,
      notes: "Low-confidence capture. Hold steady, fill the frame, avoid glare, and use the correct lab setup.",
      attempts: 1,
      manual_override_available: false,
    };
  }

  const confidence = round2(0.84 + Math.min(0.12, structure.score * 0.08) + (h % 6) / 100); // 0.84–0.98

  if (expected.type === "colour_change") {
    return {
      reading: null,
      confidence,
      pass: true,
      deviation: null,
      message: "Detected a clear, permanent colour change — looks like the endpoint.",
      notes: "Colour-change endpoint confirmed against the expected observation.",
      attempts: 1,
      manual_override_available: false,
    };
  }

  // numeric reading (burette_reading | gel_band)
  const unit = UNIT[expected.type];
  const ev = expected.expected_value ?? 0;
  const tol = expected.tolerance || (expected.type === "gel_band" ? 150 : 0.1);
  const jitter = (((h % 11) - 5) / 10) * tol; // within ±0.5·tolerance
  const reading = round2(ev + jitter);
  const deviation = round2(reading - ev);
  const pass = structure.ok && Math.abs(deviation) <= tol;
  const label = expected.type === "gel_band" ? "Band sits at" : "Reading is";

  return {
    reading,
    confidence,
    pass,
    deviation,
    message: pass
      ? `${label} ${reading} ${unit} — within ±${tol} ${unit} of expected. ✓`
      : `${label} ${reading} ${unit} — outside tolerance. Re-check and re-photograph.`,
    notes: `Expected ${ev} ${unit}, read ${reading} ${unit} (Δ ${deviation} ${unit}).`,
    attempts: 1,
    manual_override_available: false,
  };
}
