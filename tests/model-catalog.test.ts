import { describe, expect, it, vi, afterEach } from "vitest";

import { fetchModelCatalog } from "@/server/llm/model-catalog";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchModelCatalog", () => {
  it("returns a static fallback with live:false when no API key is configured", async () => {
    const result = await fetchModelCatalog("openai", undefined);
    expect(result.live).toBe(false);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("returns the live list on a successful OpenAI fetch, filtering out non-chat models", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4o", created: 100 },
          { id: "gpt-4o-mini", created: 200 },
          { id: "text-embedding-3-small", created: 300 },
          { id: "whisper-1", created: 50 },
        ],
      }),
    });
    const result = await fetchModelCatalog("openai", "sk-test");
    expect(result.live).toBe(true);
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).not.toContain("text-embedding-3-small");
    expect(ids).not.toContain("whisper-1");
    // Newest (highest `created`) first.
    expect(ids[0]).toBe("gpt-4o-mini");
  });

  it("falls back to the static list when the live fetch fails, without throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await fetchModelCatalog("gemini", "bad-key");
    expect(result.live).toBe(false);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("falls back to the static list when the API throws (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchModelCatalog("claude", "sk-ant-test");
    expect(result.live).toBe(false);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("keeps only models supporting generateContent for Gemini", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    });
    const result = await fetchModelCatalog("gemini", "test-key");
    expect(result.live).toBe(true);
    expect(result.models).toEqual([{ id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }]);
  });
});
