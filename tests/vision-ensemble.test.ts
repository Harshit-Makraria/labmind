import { describe, expect, it } from "vitest";

import { colourVoteRepresentative } from "@/server/tools/vision-ensemble";
import type { RawObservation } from "@/server/tools/vision-ensemble";

function obs(provider: "claude" | "openai" | "gemini", observed_colour: string): { provider: "claude" | "openai" | "gemini"; obs: RawObservation } {
  return { provider, obs: { reading: null, observed_colour, confidence: 0.8 } };
}

describe("colourVoteRepresentative", () => {
  it("picks the majority colour when two providers agree and one disagrees", () => {
    const observations = [obs("claude", "colourless"), obs("openai", "pink"), obs("gemini", "pink")];
    const rep = colourVoteRepresentative(observations);
    expect(rep.observed_colour).toBe("pink");
  });

  it("is case/whitespace insensitive when counting votes", () => {
    const observations = [obs("claude", " Pink "), obs("openai", "pink"), obs("gemini", "colourless")];
    const rep = colourVoteRepresentative(observations);
    expect(rep.observed_colour?.trim().toLowerCase()).toBe("pink");
  });

  it("falls back to the first observation when every provider disagrees", () => {
    const observations = [obs("claude", "colourless"), obs("openai", "pink"), obs("gemini", "blue")];
    const rep = colourVoteRepresentative(observations);
    expect(rep.observed_colour).toBe("colourless");
  });

  it("falls back to the first observation with fewer than 2 samples", () => {
    const observations = [obs("claude", "pink")];
    const rep = colourVoteRepresentative(observations);
    expect(rep.observed_colour).toBe("pink");
  });
});
