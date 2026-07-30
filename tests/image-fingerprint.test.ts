import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { fingerprint, hammingDistance, isDuplicate } from "@/server/tools/image-fingerprint";

async function stripedImage(seed: number) {
  const bands = Array.from({ length: 6 }, (_, i) => ({
    input: Buffer.from(
      // A vertical stripe of alternating brightness, shifted by `seed` — gives
      // each call a genuinely different pixel pattern rather than a near-copy.
      `<svg width="400" height="400"><rect x="${(i * 60 + seed) % 400}" y="0" width="30" height="400" fill="${i % 2 === 0 ? "#111" : "#eee"}"/></svg>`,
    ),
    left: 0,
    top: 0,
  }));
  return (
    await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } } })
      .composite(bands)
      .png()
      .toBuffer()
  ).toString("base64");
}

describe("image-fingerprint — duplicate-photo guard", () => {
  it("the exact same image byte-for-byte fingerprints identically and is flagged as a duplicate", async () => {
    const img = await stripedImage(0);
    const a = await fingerprint(img);
    const b = await fingerprint(img);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(hammingDistance(a as string, b as string)).toBe(0);
    expect(isDuplicate(a as string, b as string)).toBe(true);
  });

  it("a re-encoded (different bytes, same visual content) copy still matches — the whole point of a perceptual hash", async () => {
    const img = await stripedImage(0);
    const original = await fingerprint(img);
    // Re-encode through a resize-and-back round trip so the underlying PNG
    // bytes differ from the original, the way a re-saved/re-compressed photo
    // resubmission would, while the visual content is unchanged.
    const buf = Buffer.from(img, "base64");
    const recompressed = await sharp(buf).resize(200, 200).resize(400, 400).png().toBuffer();
    const copy = await fingerprint(recompressed.toString("base64"));
    expect(copy).not.toBeNull();
    expect(isDuplicate(original as string, copy as string)).toBe(true);
  });

  it("genuinely different images do not match", async () => {
    const a = await fingerprint(await stripedImage(0));
    const b = await fingerprint(await stripedImage(200));
    expect(isDuplicate(a as string, b as string)).toBe(false);
  });

  it("an undecodable image returns null instead of throwing", async () => {
    // route.ts relies on this: a null return (not a thrown error) is what lets
    // it distinguish "no signal" from "crashed", and is exactly the case that
    // previously skipped the duplicate guard with zero visible trace.
    await expect(fingerprint("not-valid-base64-image-data")).resolves.toBeNull();
    await expect(fingerprint("")).resolves.toBeNull();
  });
});
