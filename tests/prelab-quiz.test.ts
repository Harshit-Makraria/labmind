import { describe, expect, it } from "vitest";

import { generatePrelabQuiz } from "@/server/tools/prelab-quiz";
import { getExperiment } from "@/server/experiments";

describe("generatePrelabQuiz — per-experiment demo fallback", () => {
  it("gives each experiment its own demo quiz content, not titration's for everything", async () => {
    const ids = ["acid-base-titration", "gel-electrophoresis", "iodine-clock", "aur-experiment"];
    const quizzes = await Promise.all(
      ids.map((id) => generatePrelabQuiz(getExperiment(id).protocol, id)),
    );

    for (const q of quizzes) {
      expect(q.questions.length).toBeGreaterThan(0);
    }

    // No two experiments should share the exact same first question — that
    // would mean the fallback is still the shared titration quiz underneath.
    const firstQuestions = quizzes.map((q) => q.questions[0]?.question);
    expect(new Set(firstQuestions).size).toBe(firstQuestions.length);

    // Gel/iodine/AUR quizzes must not be titration's burette/phenolphthalein content.
    const [, gel, iodine, aur] = quizzes;
    for (const q of [gel, iodine, aur]) {
      const text = q.questions.map((x) => x.question).join(" ").toLowerCase();
      expect(text).not.toMatch(/burette|phenolphthalein|titre/);
    }
  });
});
