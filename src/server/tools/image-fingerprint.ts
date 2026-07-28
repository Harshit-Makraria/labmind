/**
 * Perceptual image fingerprinting (dHash).
 *
 * Closes a real integrity hole: nothing stopped a student resubmitting the same
 * photo for a different step, or two students submitting a photo of the same
 * apparatus. Both produce a valid reading and sail through the vision pipeline.
 *
 * dHash compares adjacent pixel brightnesses on a 9x8 greyscale thumbnail, so
 * it survives recompression, resizing and mild exposure changes — a re-saved or
 * lightly cropped copy still matches — while genuinely different photographs of
 * the same burette at different volumes do not.
 */
import "server-only";

function toBuffer(imageBase64: string): Buffer {
  const raw = imageBase64.includes(",") ? imageBase64.split(",", 2)[1] ?? "" : imageBase64;
  return Buffer.from(raw, "base64");
}

/** 64-bit difference hash, returned as 16 hex chars. */
export async function fingerprint(imageBase64: string): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    // 9 wide x 8 tall → 8 horizontal comparisons per row x 8 rows = 64 bits.
    const { data } = await sharp(toBuffer(imageBase64))
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const left = data[y * 9 + x] ?? 0;
        const right = data[y * 9 + x + 1] ?? 0;
        bits += left > right ? "1" : "0";
      }
    }
    return BigInt("0b" + bits).toString(16).padStart(16, "0");
  } catch (e) {
    console.error("[FINGERPRINT] failed:", e);
    return null;
  }
}

/** Number of differing bits between two hashes. Lower = more similar. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  while (x > 0n) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}

/**
 * Below this the images are effectively the same picture. Kept tight: two
 * genuine photos of the same burette taken seconds apart still differ by more
 * than this because the meniscus and framing move.
 */
export const DUPLICATE_THRESHOLD = 6;

export function isDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= DUPLICATE_THRESHOLD;
}
