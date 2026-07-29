import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { checkVision } from "@/server/tools/vision";

async function buretteLikeImage() {
  const stripe = await sharp({ create: { width: 120, height: 700, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
  const stem = await sharp({ create: { width: 18, height: 680, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 1 } } }).png().toBuffer();
  const img = sharp({ create: { width: 600, height: 900, channels: 4, background: { r: 245, g: 245, b: 245, alpha: 1 } } })
    .composite([{ input: stripe, left: 240, top: 100 }, { input: stem, left: 392, top: 110 }]);
  return (await img.png().toBuffer()).toString("base64");
}

describe("demoCheckVision — genuine failure is reachable without a live provider key", () => {
  it("produces at least one real out-of-tolerance miss across a spread of steps for the same clear image", async () => {
    const image = await buretteLikeImage();
    let sawGenuineMiss = false;

    for (let step = 1; step <= 40; step++) {
      const r = await checkVision({
        session_id: "t",
        step_number: step,
        image_base64: image,
        expected: { type: "burette_reading", expected_value: 24.5, tolerance: 0.1 },
      });
      if (!r.pass && r.deviation !== null && Math.abs(r.deviation) > 0.1) {
        sawGenuineMiss = true;
        expect(r.verification_status).not.toBe("auto_verified");
        break;
      }
    }

    expect(sawGenuineMiss).toBe(true);
  });

  it("is deterministic — the same image+step always gives the same verdict", async () => {
    const image = await buretteLikeImage();
    const req = {
      session_id: "t",
      step_number: 17,
      image_base64: image,
      expected: { type: "burette_reading" as const, expected_value: 24.5, tolerance: 0.1 },
    };
    const a = await checkVision(req);
    const b = await checkVision(req);
    expect(a.pass).toBe(b.pass);
    expect(a.reading).toBe(b.reading);
  });
});
