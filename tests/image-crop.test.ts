import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/llm/provider", () => ({ completeVision: vi.fn() }));

import { completeVision } from "@/server/llm/provider";
import { cropToInstrument } from "@/server/tools/image-crop";

const mockedCompleteVision = vi.mocked(completeVision);

async function testImage(width = 600, height = 900): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

beforeEach(() => {
  mockedCompleteVision.mockReset();
});

describe("cropToInstrument", () => {
  it("returns the original image untouched, with a clear reason, when the model reports it found nothing", async () => {
    mockedCompleteVision.mockResolvedValue(JSON.stringify({ found: false }));
    const image = await testImage();
    const result = await cropToInstrument(image);
    expect(result.cropped).toBe(false);
    expect(result.box).toBeNull();
    expect(result.reason).toBe("apparatus not localised");
    expect(result.imageBase64).toBe(image);
  });

  it("pads the box but clamps at the frame edge instead of going negative", async () => {
    // Box already touches the left/top edge — an 0.08 pad would push x0/y0
    // below 0 without the Math.max(0, ...) clamp.
    mockedCompleteVision.mockResolvedValue(JSON.stringify({ found: true, x0: 0.02, y0: 0.02, x1: 0.3, y1: 0.4 }));
    const image = await testImage();
    const result = await cropToInstrument(image);
    expect(result.box).not.toBeNull();
    expect(result.box!.x0).toBe(0);
    expect(result.box!.y0).toBe(0);
  });

  it("skips cropping when the box already covers most of the frame, but still returns the box for the UI overlay", async () => {
    // A near-full-frame box: after padding this covers well over 85% of area.
    mockedCompleteVision.mockResolvedValue(JSON.stringify({ found: true, x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.95 }));
    const image = await testImage();
    const result = await cropToInstrument(image);
    expect(result.cropped).toBe(false);
    expect(result.reason).toContain("crop not useful");
    expect(result.box).not.toBeNull();
    expect(result.imageBase64).toBe(image); // untouched original bytes
  });

  it("crops and upscales a genuinely small, well-defined box, producing output dimensions matching the computed scale", async () => {
    // A tall, narrow box (burette-shaped) covering a small fraction of a
    // 600x900 frame — small enough to trigger the upscale path.
    mockedCompleteVision.mockResolvedValue(JSON.stringify({ found: true, x0: 0.4, y0: 0.1, x1: 0.55, y1: 0.5 }));
    const image = await testImage(600, 900);
    const result = await cropToInstrument(image);
    expect(result.cropped).toBe(true);
    expect(result.box).not.toBeNull();
    expect(result.reason).toContain("upscaled");

    // Hand-computed crop geometry: padded box -> left=192,top=18,width=186,height=504
    // (the long edge). TARGET_LONG_EDGE=1400, so the output's long edge should
    // land at ~1400 — genuinely upscaled, not returned at native crop resolution.
    const outBuf = Buffer.from(result.imageBase64, "base64");
    const outMeta = await sharp(outBuf).metadata();
    const longEdge = Math.max(outMeta.width ?? 0, outMeta.height ?? 0);
    expect(longEdge).toBeGreaterThan(504); // upscaled well past the native crop height
    expect(longEdge).toBeGreaterThanOrEqual(1395);
    expect(longEdge).toBeLessThanOrEqual(1405);
  });
});
