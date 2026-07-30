import { describe, expect, it } from "vitest";

import { resolveCapabilityProvider, resolveWaterfallOrder } from "@/server/config";

describe("resolveWaterfallOrder", () => {
  it("defaults chat to OpenAI -> Gemini -> Claude", () => {
    expect(resolveWaterfallOrder("chat", "auto")).toEqual(["openai", "gemini", "claude"]);
  });

  it("defaults vision to Gemini -> OpenAI -> Claude", () => {
    expect(resolveWaterfallOrder("vision", "auto")).toEqual(["gemini", "openai", "claude"]);
  });

  it("puts a pinned provider first, then the rest in the capability's default order", () => {
    expect(resolveWaterfallOrder("chat", "claude")).toEqual(["claude", "openai", "gemini"]);
    expect(resolveWaterfallOrder("vision", "openai")).toEqual(["openai", "gemini", "claude"]);
  });

  it("supports every pairing — e.g. Claude for chat + OpenAI for vision — independently", () => {
    const chat = resolveWaterfallOrder("chat", "claude");
    const vision = resolveWaterfallOrder("vision", "openai");
    expect(chat[0]).toBe("claude");
    expect(vision[0]).toBe("openai");
  });
});

describe("resolveCapabilityProvider", () => {
  it("uses the per-capability override when the top-level mode is auto", () => {
    expect(resolveCapabilityProvider("auto", "claude")).toBe("claude");
    expect(resolveCapabilityProvider("auto", undefined)).toBe("auto");
  });

  it("a single-provider top-level mode forces the capability regardless of any override", () => {
    expect(resolveCapabilityProvider("openai", "claude")).toBe("openai");
    expect(resolveCapabilityProvider("gemini", undefined)).toBe("gemini");
  });
});
