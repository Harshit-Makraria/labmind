import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { checkVision } from "@/server/tools/vision";

async function makeImageBase64(width: number, height: number, background: { r: number; g: number; b: number }, overlays: Array<{ input: Buffer; left: number; top: number }> = []) {
  let img = sharp({ create: { width, height, channels: 4, background: { ...background, alpha: 1 } } });
  if (overlays.length > 0) img = img.composite(overlays);
  return (await img.png().toBuffer()).toString("base64");
}

async function buretteLikeImage() {
  const stripe = await sharp({ create: { width: 120, height: 700, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
  const stem = await sharp({ create: { width: 18, height: 680, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } } }).png().toBuffer();
  return makeImageBase64(600, 900, { r: 245, g: 245, b: 245 }, [
    { input: stripe, left: 240, top: 100 },
    { input: stem, left: 392, top: 110 },
  ]);
}

async function gelLikeImage() {
  const band = await sharp({ create: { width: 900, height: 36, channels: 4, background: { r: 35, g: 35, b: 35, alpha: 1 } } }).png().toBuffer();
  return makeImageBase64(1200, 600, { r: 250, g: 250, b: 250 }, [
    { input: band, left: 140, top: 120 },
    { input: band, left: 120, top: 260 },
    { input: band, left: 160, top: 400 },
  ]);
}

async function colourChangeLikeImage() {
  const left = await sharp({ create: { width: 450, height: 600, channels: 4, background: { r: 220, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();
  const right = await sharp({ create: { width: 450, height: 600, channels: 4, background: { r: 40, g: 180, b: 90, alpha: 1 } } }).png().toBuffer();
  return makeImageBase64(900, 600, { r: 255, g: 255, b: 255 }, [
    { input: left, left: 0, top: 0 },
    { input: right, left: 450, top: 0 },
  ]);
}

describe("vision tool (golden dataset)", () => {
  it("clear burette near 24.5 mL → pass with high confidence", async () => {
    const bigImage = await buretteLikeImage();
    const r = checkVision({
      session_id: "t",
      step_number: 5,
      image_base64: bigImage,
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
    });
    const resolved = await r;
    expect(resolved.pass).toBe(true);
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.8);
    expect(Math.abs((resolved.reading ?? 0) - 24.5)).toBeLessThanOrEqual(0.1);
  });

  it("blank/tiny image → low confidence, re-photograph", async () => {
    const r = checkVision({
      session_id: "t",
      step_number: 5,
      image_base64: await makeImageBase64(80, 80, { r: 255, g: 255, b: 255 }),
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
    });
    const resolved = await r;
    expect(resolved.pass).toBe(false);
    expect(resolved.confidence).toBeLessThan(0.75);
    expect(resolved.message.toLowerCase()).toMatch(/unclear|image is too small|does not resemble/);
  });

  it("gel-like image does not pass burette verification", async () => {
    const r = await checkVision({
      session_id: "t",
      step_number: 5,
      image_base64: await gelLikeImage(),
      expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
    });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/burette|reading image|does not resemble/i);
  });

  it("colour-change endpoint passes on a clear image", async () => {
    const r = checkVision({
      session_id: "t",
      step_number: 4,
      image_base64: await colourChangeLikeImage(),
      expected: { type: "colour_change", expected_value: null, tolerance: 0 },
    });
    const resolved = await r;
    expect(resolved.pass).toBe(true);
  });

  it("reads a gel band in bp", async () => {
    const r = checkVision({
      session_id: "t",
      step_number: 6,
      image_base64: await gelLikeImage(),
      expected: { type: "gel_band", expected_value: 1500, tolerance: 150 },
    });
    const resolved = await r;
    expect(resolved.reading).not.toBeNull();
    expect(resolved.notes).toMatch(/bp/);
  });
});
