import { describe, expect, it } from "vitest";

import { extractPdfText, parseProtocol } from "@/server/tools/protocol-parser";
import { getProtocol } from "@/server/experiments";

describe("extractPdfText", () => {
  it("returns null (not throw) for bytes that aren't a valid PDF at all", async () => {
    const garbage = Buffer.from("this is not a pdf").toString("base64");
    const result = await extractPdfText(garbage);
    expect(result).toBeNull();
  });

  it("returns null (not throw) for an empty string", async () => {
    const result = await extractPdfText("");
    expect(result).toBeNull();
  });
});

describe("parseProtocol", () => {
  it("with no pdfBase64 returns the library protocol directly, untouched", async () => {
    const result = await parseProtocol(undefined, "acid-base-titration");
    expect(result).toEqual(getProtocol("acid-base-titration"));
  });

  // No LLM provider keys are present in the vitest process (nothing loads
  // .env here — the same reason tests/vision-demo-failure.test.ts can rely on
  // demo mode with no live key), so effectiveDemo() is true and this exercises
  // the real "can't structure an uploaded PDF without a key" fallback path,
  // not a mock standing in for it.
  it("with a pdfBase64 but no LLM key available (demo mode), falls back to the library protocol instead of crashing", async () => {
    const fakePdf = Buffer.from("%PDF-1.4 fake").toString("base64");
    const result = await parseProtocol(fakePdf, "acid-base-titration");
    expect(result).toEqual(getProtocol("acid-base-titration"));
  });

  it("falls back to the DEFAULT experiment's protocol when no experimentId is given either", async () => {
    const result = await parseProtocol(undefined, undefined);
    expect(result).toEqual(getProtocol(undefined));
    expect(result.steps.length).toBeGreaterThan(0);
  });
});
