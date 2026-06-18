import "server-only";
import { completeJSON } from "@/server/llm/provider";
import { effectiveDemo } from "@/server/config";
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

const DEMO_QUIZ: PrelabQuiz = {
  passing_score: 60,
  questions: [
    { id: "q1", question: "What is the purpose of a burette in a titration?", options: ["To measure temperature", "To deliver precise volumes of solution", "To stir the solution", "To measure pH"], correct: 1, explanation: "A burette allows precise delivery of titrant volumes, readable to 0.05 mL." },
    { id: "q2", question: "What colour change indicates the endpoint with phenolphthalein?", options: ["Yellow to orange", "Blue to colourless", "Colourless to pink", "Red to blue"], correct: 2, explanation: "Phenolphthalein is colourless in acid and turns pink/fuchsia at the alkaline endpoint." },
    { id: "q3", question: "Why must you rinse the burette with the titrant solution before use?", options: ["To cool it down", "To remove residual water that would dilute the titrant", "To make it easier to read", "To check for leaks"], correct: 1, explanation: "Residual water dilutes the titrant, changing its concentration and making results inaccurate." },
    { id: "q4", question: "What PPE is essential for this experiment?", options: ["Earplugs only", "Safety goggles, lab coat, and gloves", "Gloves only", "No PPE required"], correct: 1, explanation: "Acids and alkalis are corrosive — full PPE protects eyes, skin, and clothing." },
    { id: "q5", question: "What does a titre value represent?", options: ["The pH of the solution", "The mass of the solute", "The volume of titrant used to reach the endpoint", "The temperature of the reaction"], correct: 2, explanation: "The titre is the exact volume of titrant dispensed from the burette to reach the colour-change endpoint." },
  ],
};

export async function generatePrelabQuiz(protocol: Protocol, experimentId: string): Promise<PrelabQuiz> {
  if (effectiveDemo()) return DEMO_QUIZ;

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
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) throw new Error("bad shape");
    return parsed;
  } catch {
    return DEMO_QUIZ;
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
