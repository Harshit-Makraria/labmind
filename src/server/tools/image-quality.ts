/**
 * Pre-flight image quality gate.
 *
 * Runs before any model call. A blurry, too-dark, or blown-out photo cannot
 * produce a trustworthy reading, so there is no point paying for the
 * inference — and the student gets a specific, actionable instruction ("too
 * blurry") instead of a vague "low confidence" several seconds later.
 *
 * Deliberately does NOT reject on pixel dimensions — any dimension image can
 * be submitted. A small-but-sharp crop is perfectly readable, and the AI
 * ensemble reports its own low confidence / null reading for a photo that's
 * genuinely too small to make out graduations, which is a better judge of
 * "can this actually be read" than an arbitrary width/height cutoff.
 */
import "server-only";

export interface QualityReport {
  ok: boolean;
  width: number;
  height: number;
  /** Variance of the Laplacian — the standard sharpness proxy. Higher = sharper. */
  sharpness: number;
  brightness: number;
  /** Student-facing reason, present only when ok === false. */
  reason: string | null;
  /** Short code for logging/metrics. */
  code: "too_blurry" | "too_dark" | "too_bright" | "unreadable" | null;
}

// Tuned for phone photos of glassware. Deliberately permissive — this gate is
// meant to catch obviously unusable input, not to second-guess borderline shots
// (the confidence pipeline handles those).
const MIN_SHARPNESS = 8;     // below this, graduation marks smear together
const MIN_BRIGHTNESS = 30;   // 0–255
const MAX_BRIGHTNESS = 240;  // blown-out highlights hide the meniscus

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
}

export async function assessQuality(imageBase64: string): Promise<QualityReport> {
  const fail = (code: QualityReport["code"], reason: string, partial: Partial<QualityReport> = {}): QualityReport => ({
    ok: false, width: 0, height: 0, sharpness: 0, brightness: 0, ...partial, reason, code,
  });

  try {
    const { default: sharp } = await import("sharp");
    const buf = toBuffer(imageBase64);
    const img = sharp(buf);
    const meta = await img.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (!width || !height) return fail("unreadable", "That file could not be read as an image.");

    // Mean brightness from the greyscale channel.
    const grey = sharp(buf).greyscale();
    const { channels } = await grey.stats();
    const brightness = Math.round(channels[0]?.mean ?? 0);

    if (brightness < MIN_BRIGHTNESS) {
      return fail("too_dark", "Photo is too dark to read the graduations. Turn on more light and retake.", { width, height, brightness });
    }
    if (brightness > MAX_BRIGHTNESS) {
      return fail("too_bright", "Photo is overexposed — the scale is washed out. Move out of direct glare and retake.", { width, height, brightness });
    }

    // Sharpness: convolve with a Laplacian kernel; the stdev of the response is
    // a well-established blur proxy (flat response = no edges = out of focus).
    const lap = await sharp(buf)
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
      .stats();
    const sharpness = Math.round((lap.channels[0]?.stdev ?? 0) * 10) / 10;

    if (sharpness < MIN_SHARPNESS) {
      return fail("too_blurry", "Photo is out of focus — the graduation marks are not sharp. Hold steady, tap to focus, and retake.", { width, height, brightness, sharpness });
    }

    return { ok: true, width, height, sharpness, brightness, reason: null, code: null };
  } catch (e) {
    // Never block a submission because the quality check itself broke.
    console.error("[QUALITY] assessment failed, allowing through:", e);
    return { ok: true, width: 0, height: 0, sharpness: 0, brightness: 0, reason: null, code: null };
  }
}
