import { describe, it, expect } from "vitest";
import { checkVision } from "@/server/tools/vision";
import sharp from "sharp";

describe("universal descriptive vision check — demo mode", () => {
  it("produces at least one failure across a spread of steps", async () => {
    const img = (await sharp({ create: { width: 900, height: 700, channels: 3, background: { r: 190, g: 200, b: 210 } } })
      .composite([{ input: Buffer.from(`<svg width="900" height="700"><rect x="60" y="60" width="360" height="260" fill="#111"/><text x="90" y="220" font-size="90" fill="#0f0">0.52 A</text><rect x="480" y="60" width="360" height="260" fill="#111"/></svg>`), top: 0, left: 0 }])
      .jpeg({ quality: 92 }).toBuffer()).toString("base64");

    const results: boolean[] = [];
    for (let step = 1; step <= 40; step++) {
      const r = await checkVision({
        session_id: "t", step_number: step, image_base64: img,
        expected: { type: "descriptive", expected_value: null, tolerance: 0, description: "Both meters readable", must_show: ["ammeter visible", "voltmeter visible"] },
      });
      results.push(r.pass);
    }
    expect(results.some((p) => p === false)).toBe(true);
    expect(results.some((p) => p === true)).toBe(true);
  }, 60000);
});
