/**
 * Two-pass "zoom and read".
 *
 * In a typical student photo the burette occupies ~15% of the frame; the rest
 * is bench, shelving and window. Vision models tile an image into fixed-size
 * patches and downsample large inputs (Claude caps the long edge around 1568px),
 * so the graduation marks — the only pixels that matter — end up with a tiny
 * share of the model's attention.
 *
 * Pass 1 asks the model only for the instrument's bounding box (cheap, coarse).
 * We then crop to it and upscale, so pass 2 reads a tall strip that is almost
 * entirely scale. This is the single largest accuracy lever in the pipeline.
 */
import "server-only";
import { completeVision } from "@/server/llm/provider";

const LOCATE_SYSTEM = `You locate laboratory apparatus in photographs.
Return only the bounding box, as JSON. Do not read any values.`;

const LOCATE_PROMPT = `Find the main piece of graduated laboratory apparatus in this photo
(a burette, measuring cylinder, or gel image).

Return the tightest box that contains the full graduated scale, as fractions of the
image dimensions (0.0 = left/top edge, 1.0 = right/bottom edge).

Return JSON:
{
  "found": <true|false>,
  "x0": <number 0-1, left edge>,
  "y0": <number 0-1, top edge>,
  "x1": <number 0-1, right edge>,
  "y1": <number 0-1, bottom edge>
}`;

export interface CropResult {
  /** Base64 of the cropped+upscaled image, or the original when cropping was skipped. */
  imageBase64: string;
  cropped: boolean;
  reason: string;
  /** The located box as fractions (0-1) of the ORIGINAL image — the padded
   * region actually cropped to, so the UI can draw it on the photo the
   * student submitted rather than the (differently-sized) cropped output. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
}

/** Longest edge we send to the model. Matches Claude's effective input ceiling. */
const TARGET_LONG_EDGE = 1400;

export async function cropToInstrument(imageBase64: string): Promise<CropResult> {
  const original: CropResult = { imageBase64, cropped: false, reason: "", box: null };

  try {
    const raw = await completeVision(LOCATE_SYSTEM, {
      imageBase64: imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? imageBase64 : imageBase64,
      prompt: LOCATE_PROMPT,
    });

    const box = JSON.parse(raw) as { found?: boolean; x0?: number; y0?: number; x1?: number; y1?: number };
    if (!box.found || [box.x0, box.y0, box.x1, box.y1].some((v) => typeof v !== "number")) {
      return { ...original, reason: "apparatus not localised" };
    }

    const { default: sharp } = await import("sharp");
    const buf = toBuffer(imageBase64);
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H) return { ...original, reason: "no dimensions" };

    // Pad the box so we never clip the graduations at the boundary.
    const PAD = 0.08;
    const x0 = Math.max(0, Math.min(box.x0!, box.x1!) - PAD);
    const x1 = Math.min(1, Math.max(box.x0!, box.x1!) + PAD);
    const y0 = Math.max(0, Math.min(box.y0!, box.y1!) - PAD);
    const y1 = Math.min(1, Math.max(box.y0!, box.y1!) + PAD);

    const left = Math.round(x0 * W);
    const top = Math.round(y0 * H);
    const width = Math.round((x1 - x0) * W);
    const height = Math.round((y1 - y0) * H);

    // A "crop" that keeps most of the frame buys nothing but costs a call's
    // worth of latency — skip cropping, but the model DID genuinely locate
    // the instrument, so still surface that box for the UI overlay.
    const areaRatio = (width * height) / (W * H);
    if (width < 40 || height < 40 || areaRatio > 0.85) {
      return { ...original, reason: `crop not useful (covers ${Math.round(areaRatio * 100)}% of frame)`, box: { x0, y0, x1, y1 } };
    }

    const scale = TARGET_LONG_EDGE / Math.max(width, height);
    let pipeline = sharp(buf).extract({ left, top, width, height });
    if (scale > 1) {
      // Upscale so the graduations occupy more model patches. Lanczos keeps
      // thin scale lines crisp where a bilinear resize would smear them.
      pipeline = pipeline.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        kernel: "lanczos3",
      });
    }
    // Mild sharpening recovers edge definition lost to upscaling.
    const out = await pipeline.sharpen().jpeg({ quality: 92 }).toBuffer();

    console.log(`[CROP] ${W}×${H} → ${width}×${height} (${Math.round(areaRatio * 100)}% of frame), upscaled ×${scale.toFixed(1)}`);
    return {
      imageBase64: out.toString("base64"),
      cropped: true,
      reason: `cropped to ${Math.round(areaRatio * 100)}% region, upscaled ×${scale.toFixed(1)}`,
      box: { x0, y0, x1, y1 },
    };
  } catch (e) {
    // Cropping is an optimisation — never let it break the read.
    console.warn("[CROP] failed, using original image:", e);
    return { ...original, reason: "crop failed" };
  }
}
