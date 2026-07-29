import "server-only";
import { completeJSON } from "@/server/llm/provider";
import { effectiveDemo } from "@/server/config";
import { db } from "@/server/db";
import type { Protocol } from "@/lib/types";

export interface QuizQuestion {
  id: string;
  question: string;
  options: [string, string, string, string];
  correct: number; // 0-3 index
  explanation: string;
}

export interface PrelabQuiz {
  questions: QuizQuestion[];
  passing_score: number; // percentage
}

export interface QuizResult {
  score: number; // 0-100
  passed: boolean;
  correct: number;
  total: number;
  feedback: { question_id: string; correct: boolean; explanation: string }[];
}

const TITRATION_QUIZ: PrelabQuiz = {
  passing_score: 60,
  questions: [
    { id: "q1", question: "What is the purpose of a burette in a titration?", options: ["To measure temperature", "To deliver precise volumes of solution", "To stir the solution", "To measure pH"], correct: 1, explanation: "A burette allows precise delivery of titrant volumes, readable to 0.05 mL." },
    { id: "q2", question: "What colour change indicates the endpoint with phenolphthalein?", options: ["Yellow to orange", "Blue to colourless", "Colourless to pink", "Red to blue"], correct: 2, explanation: "Phenolphthalein is colourless in acid and turns pink/fuchsia at the alkaline endpoint." },
    { id: "q3", question: "Why must you rinse the burette with the titrant solution before use?", options: ["To cool it down", "To remove residual water that would dilute the titrant", "To make it easier to read", "To check for leaks"], correct: 1, explanation: "Residual water dilutes the titrant, changing its concentration and making results inaccurate." },
    { id: "q4", question: "What PPE is essential for this experiment?", options: ["Earplugs only", "Safety goggles, lab coat, and gloves", "Gloves only", "No PPE required"], correct: 1, explanation: "Acids and alkalis are corrosive — full PPE protects eyes, skin, and clothing." },
    { id: "q5", question: "What does a titre value represent?", options: ["The pH of the solution", "The mass of the solute", "The volume of titrant used to reach the endpoint", "The temperature of the reaction"], correct: 2, explanation: "The titre is the exact volume of titrant dispensed from the burette to reach the colour-change endpoint." },
  ],
};

const GEL_ELECTROPHORESIS_QUIZ: PrelabQuiz = {
  passing_score: 60,
  questions: [
    { id: "q1", question: "Why does DNA migrate toward the positive electrode (anode) during gel electrophoresis?", options: ["DNA is positively charged", "DNA's phosphate backbone is negatively charged", "The gel repels DNA from the negative side", "It doesn't — it migrates toward the negative electrode"], correct: 1, explanation: "The sugar-phosphate backbone carries a negative charge, so DNA is drawn toward the anode in an electric field." },
    { id: "q2", question: "What is the purpose of the DNA ladder loaded alongside samples?", options: ["To make the gel conduct electricity", "A size reference with known fragment lengths", "To stain the DNA", "To neutralise the buffer"], correct: 1, explanation: "The ladder's known band sizes let you estimate an unknown sample's fragment size by interpolation." },
    { id: "q3", question: "Why is loading dye added to samples before loading them into the gel?", options: ["It stains the DNA permanently", "It adds density so the sample sinks into the well and lets you track migration", "It speeds up the DNA's migration", "It is required for the DNA to fluoresce"], correct: 1, explanation: "Loading dye's glycerol/sucrose weighs the sample down into the well, and its colour tracks how far the run has progressed." },
    { id: "q4", question: "What safety precaution is essential when viewing a SYBR Safe-stained gel under UV/blue light?", options: ["No precaution needed — it's completely inert", "Wear UV-protective eyewear and avoid direct skin exposure", "Only handle the gel while it's still in the tank", "Wear ear protection"], correct: 1, explanation: "UV/blue transilluminators can damage eyes and skin with prolonged exposure — protective eyewear is required." },
    { id: "q5", question: "Why is the gel run in TAE (or TBE) buffer rather than plain water?", options: ["Buffer looks better under UV light", "It maintains a stable pH and conducts current evenly through the gel", "It dissolves the agarose faster", "It is required to activate the DNA ladder"], correct: 1, explanation: "A buffered running solution keeps pH stable and provides consistent conductivity, so bands migrate evenly." },
  ],
};

const IODINE_CLOCK_QUIZ: PrelabQuiz = {
  passing_score: 60,
  questions: [
    { id: "q1", question: "What visible change marks the endpoint of the iodine clock reaction?", options: ["The solution turns clear", "A sudden blue-black colour appears", "The solution boils", "A precipitate sinks to the bottom"], correct: 1, explanation: "Starch forms an intensely coloured blue-black complex with iodine the instant free iodine appears, giving a sharp, suddenly-visible endpoint." },
    { id: "q2", question: "What does timing the colour change let you calculate?", options: ["The pH of the solution", "The reaction rate (as 1/time)", "The molar mass of iodine", "The boiling point of the mixture"], correct: 1, explanation: "Rate = 1/t — a faster colour change means a shorter time and a higher measured rate." },
    { id: "q3", question: "Why must the timer be started at the exact moment the reagents are mixed?", options: ["It doesn't matter, only the final colour matters", "The elapsed time between mixing and colour change IS the measurement", "To satisfy lab safety rules", "To let the solution reach room temperature"], correct: 1, explanation: "The whole result is a measured time interval, so any delay in starting the timer directly corrupts the rate calculation." },
    { id: "q4", question: "What is an important safety consideration when handling the oxidising reagent (e.g. H2O2) in this experiment?", options: ["No special handling is needed", "Avoid contact with skin/eyes and keep it away from reducing agents outside the planned reaction", "It must be refrigerated at all times during use", "It should be handled only in complete darkness"], correct: 1, explanation: "Oxidisers like hydrogen peroxide are corrosive and reactive — standard PPE and controlled mixing are required." },
    { id: "q5", question: "What would repeating the reaction at a higher temperature be expected to do to the measured rate?", options: ["Decrease the rate", "Have no effect on the rate", "Increase the rate (shorter time to colour change)", "Prevent the colour change entirely"], correct: 2, explanation: "Higher temperature increases molecular collision frequency/energy, speeding up the reaction and shortening the time to the endpoint." },
  ],
};

const AUR_QUIZ: PrelabQuiz = {
  passing_score: 60,
  questions: [
    { id: "q1", question: "What does the Beer-Lambert law relate absorbance to?", options: ["Temperature of the sample", "Concentration of the absorbing species", "Volume of the cuvette", "Wavelength of visible light only"], correct: 1, explanation: "A = ε·c·l — absorbance is directly proportional to the concentration of the absorbing species (at fixed path length and wavelength)." },
    { id: "q2", question: "Why must the spectrophotometer be blanked with a reference solution before measuring a sample?", options: ["To warm up the lamp", "To zero out absorbance from the solvent/cuvette so only the sample's absorbance is measured", "To calibrate the wavelength dial", "Blanking is optional and only affects colour, not the reading"], correct: 1, explanation: "Blanking removes the baseline contribution of the cuvette and solvent, so the displayed absorbance reflects only the analyte." },
    { id: "q3", question: "Why should cuvettes be handled by their ridged/frosted sides rather than the clear optical faces?", options: ["Fingerprints on the optical faces scatter/absorb light and skew the reading", "It's just a convention with no effect on results", "Touching the clear faces will crack the cuvette", "It prevents the solution from evaporating"], correct: 0, explanation: "Smudges or fingerprints on the light path introduce extra scattering/absorbance, producing an inaccurate reading." },
    { id: "q4", question: "What does it mean if a diluted sample's absorbance reading exceeds ~2 AU?", options: ["The result is unusually precise", "The reading is likely unreliable — Beer-Lambert linearity breaks down at high absorbance", "The spectrophotometer needs a new lamp", "The concentration is exactly zero"], correct: 1, explanation: "Very high absorbance readings fall outside the instrument's reliable linear range — the sample should be diluted and re-measured." },
    { id: "q5", question: "Why is a matched pair of cuvettes (or the same cuvette reused) recommended for blank and sample readings?", options: ["It looks more professional", "Differences in cuvette thickness/quality between vessels can introduce a systematic error", "It saves reagents", "It changes the wavelength used"], correct: 1, explanation: "Using mismatched cuvettes can add a constant offset or scattering difference between the blank and sample readings, biasing the result." },
  ],
};

const DEMO_QUIZZES: Record<string, PrelabQuiz> = {
  "acid-base-titration": TITRATION_QUIZ,
  "gel-electrophoresis": GEL_ELECTROPHORESIS_QUIZ,
  "iodine-clock": IODINE_CLOCK_QUIZ,
  "aur-experiment": AUR_QUIZ,
};

function demoQuizFor(experimentId: string): PrelabQuiz {
  return DEMO_QUIZZES[experimentId] ?? TITRATION_QUIZ;
}

/**
 * Generated quizzes are pinned per experiment, in-process AND in the DB.
 *
 * The GET handler serves the quiz (answers stripped) and the POST handler
 * re-derives it to score the submission. Without pinning, the LLM produces a
 * DIFFERENT quiz on each call while reusing the same q1…q5 ids — so students
 * were graded against an answer key for questions they never saw. The DB layer
 * matters because on serverless the GET and POST can land on different
 * instances, where an in-memory cache alone is cold.
 */
const quizCache = new Map<string, PrelabQuiz>();
const quizKey = (experimentId: string) => `prelab.quiz.${experimentId}`;

export function clearPrelabQuizCache(experimentId?: string) {
  if (experimentId) quizCache.delete(experimentId);
  else quizCache.clear();
}

function isWellFormed(q: PrelabQuiz): boolean {
  return (
    Array.isArray(q.questions) &&
    q.questions.length > 0 &&
    q.questions.every(
      (x) => Array.isArray(x.options) && x.options.length === 4 && x.correct >= 0 && x.correct <= 3,
    )
  );
}

export async function generatePrelabQuiz(protocol: Protocol, experimentId: string): Promise<PrelabQuiz> {
  if (effectiveDemo()) return demoQuizFor(experimentId);

  const cached = quizCache.get(experimentId);
  if (cached) return cached;

  // Shared across serverless instances — this is what keeps GET and POST in sync.
  try {
    const row = await db.appSetting.findUnique({ where: { key: quizKey(experimentId) } });
    if (row?.value) {
      const stored = JSON.parse(row.value) as PrelabQuiz;
      if (isWellFormed(stored)) {
        quizCache.set(experimentId, stored);
        return stored;
      }
    }
  } catch { /* fall through and regenerate */ }

  const stepSummary = protocol.steps.slice(0, 5).map((s) => `Step ${s.step_number}: ${s.title} — ${s.instructions.slice(0, 2).join(". ")}`).join("\n");

  const system = `You are an expert science educator. Generate a pre-lab quiz to check student readiness before a laboratory experiment.
Return ONLY valid JSON — no markdown, no commentary.`;

  const user = `Experiment: "${protocol.experiment_name}"
Key steps:
${stepSummary}

Generate exactly 5 multiple-choice questions that test:
1. Purpose of the experiment
2. Key technique or measurement method
3. A safety rule specific to this experiment
4. An indicator/observation the student must recognise
5. A potential source of error or how to minimise it

Return JSON:
{
  "passing_score": 60,
  "questions": [
    {
      "id": "q1",
      "question": "<question text>",
      "options": ["<A>", "<B>", "<C>", "<D>"],
      "correct": <0-3 index of correct option>,
      "explanation": "<why this is correct, in one sentence>"
    }
    ... (5 total)
  ]
}`;

  try {
    const raw = await completeJSON(system, user);
    const parsed = JSON.parse(raw) as PrelabQuiz;
    // Reject a malformed quiz (missing options, out-of-range answer index) —
    // otherwise every answer scores wrong and no student can ever pass.
    if (!isWellFormed(parsed)) throw new Error("malformed quiz");
    if (typeof parsed.passing_score !== "number") parsed.passing_score = 60;

    quizCache.set(experimentId, parsed);
    const value = JSON.stringify(parsed);
    await db.appSetting
      .upsert({ where: { key: quizKey(experimentId) }, create: { key: quizKey(experimentId), value }, update: { value } })
      .catch(() => { /* in-memory cache still holds it for this instance */ });
    return parsed;
  } catch {
    return demoQuizFor(experimentId);
  }
}

export function scorePrelabQuiz(quiz: PrelabQuiz, answers: Record<string, number>): QuizResult {
  let correct = 0;
  const feedback = quiz.questions.map((q) => {
    const studentAnswer = answers[q.id] ?? -1;
    const isCorrect = studentAnswer === q.correct;
    if (isCorrect) correct++;
    return { question_id: q.id, correct: isCorrect, explanation: q.explanation };
  });
  const score = Math.round((correct / quiz.questions.length) * 100);
  return { score, passed: score >= quiz.passing_score, correct, total: quiz.questions.length, feedback };
}
