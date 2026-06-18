/**
 * Result Interpreter tool (Feature 4) — deviation diagnosis + coaching.
 *
 * Deterministic pedagogical engine, now experiment-aware: titration errors point
 * to parallax/endpoint, gel to ladder interpolation, kinetics to timing. Grades
 * green/amber/red by magnitude and tailors the root cause to magnitude+direction.
 */
import "server-only";
import type { InterpretRequest, InterpretResult, ResultSeverity } from "@/lib/types";
import { getExperiment } from "@/server/experiments";

const round1 = (n: number) => Math.round(n * 10) / 10;

function grade(deviation: number): ResultSeverity {
  if (deviation <= 2) return "green";
  if (deviation <= 10) return "amber";
  return "red";
}

interface Copy {
  diagnosis: string;
  improvement: string;
  learning_point: string;
}

export function interpret(req: InterpretRequest): InterpretResult {
  const theo = req.theoretical_value;
  const deviation = theo !== 0 ? round1((Math.abs(req.student_result - theo) / theo) * 100) : 0;
  const severity = grade(deviation);
  const under = req.student_result < theo;
  const domain = getExperiment(req.experiment_id).domain;
  const copy = byDomain(domain, severity, under, deviation);
  return { deviation_percent: deviation, severity, ...copy };
}

function byDomain(
  domain: "chemistry" | "biology" | "kinetics",
  severity: ResultSeverity,
  under: boolean,
  deviation: number,
): Copy {
  const d = `${deviation}%`;
  if (severity === "green") {
    const green: Record<typeof domain, Copy> = {
      chemistry: {
        diagnosis: "Excellent — within experimental error of the expected value. Your titration technique was sound.",
        improvement: "Keep reading the meniscus at eye level and record to two decimals to stay this accurate.",
        learning_point: "Concordant titres within ±0.1 mL are the hallmark of good volumetric technique.",
      },
      biology: {
        diagnosis: "Great call — your size estimate lands within tolerance of the ladder.",
        improvement: "Run a few more ladder lanes next time to tighten interpolation at the extremes.",
        learning_point: "Migration distance scales with log(size); reading against a ladder is how you stay accurate.",
      },
      kinetics: {
        diagnosis: "Spot on — your rate matches the expected value within experimental error.",
        improvement: "Trigger the stopwatch on the first hint of colour to keep timing this crisp.",
        learning_point: "For a clock reaction, timing precision is the dominant source of error — you nailed it.",
      },
    };
    return green[domain];
  }

  if (severity === "amber") {
    const amber: Record<typeof domain, [Copy, Copy]> = {
      chemistry: [
        {
          diagnosis: `Your result is ${d} below expected — likely under-titration: stopping before the true endpoint, or a low (parallax) burette reading.`,
          improvement: "Near the endpoint add NaOH dropwise and wait for the pink to persist ~30 s; read at eye level.",
          learning_point: "A faint, permanent pink is the endpoint; a fleeting pink that fades means you're not there yet.",
        },
        {
          diagnosis: `Your result is ${d} above expected — likely overshooting the endpoint past the first permanent pink.`,
          improvement: "Slow to dropwise addition and swirl constantly; the endpoint is a single drop.",
          learning_point: "Past equivalence each extra drop adds error — the endpoint is the first permanent colour, not a deep pink.",
        },
      ],
      biology: [
        {
          diagnosis: `Your estimate is ${d} small — the band likely ran slightly further than you read, or the gel ran long.`,
          improvement: "Interpolate against the two nearest ladder bands and stop the run when the dye front is ~⅔ down.",
          learning_point: "Over-running the gel compresses large fragments and biases size estimates low.",
        },
        {
          diagnosis: `Your estimate is ${d} large — the band may not have migrated far enough, or voltage/time was low.`,
          improvement: "Run at the recommended 100 V for the full time and re-read against the ladder.",
          learning_point: "Smaller fragments travel farther; under-running makes everything look bigger.",
        },
      ],
      kinetics: [
        {
          diagnosis: `Your rate is ${d} low — likely a late stopwatch stop (reacting after the colour, not on it).`,
          improvement: "Watch on a white tile and stop the clock at the very first blue-black flash.",
          learning_point: "Human reaction lag systematically lengthens the measured time and lowers the rate.",
        },
        {
          diagnosis: `Your rate is ${d} high — likely an early stop, or warmer reagents speeding the reaction.`,
          improvement: "Equilibrate reagents to room temperature and stop exactly on the colour change.",
          learning_point: "Temperature strongly affects rate; control it to compare runs fairly.",
        },
      ],
    };
    return amber[domain][under ? 0 : 1];
  }

  // red
  const red: Record<typeof domain, Copy> = {
    chemistry: {
      diagnosis: `Your result is ${d} off — a large deviation pointing to a systematic error: a misread burette, an unrinsed burette diluting the NaOH, or a slip in n = C×V.`,
      improvement: "Repeat with a freshly rinsed burette, recheck final − initial volume, and recompute C(HCl) = n / 0.025.",
      learning_point: "Large one-directional errors are systematic, not random — find the single step that biased every reading.",
    },
    biology: {
      diagnosis: `Your estimate is ${d} off — that's beyond interpolation error and suggests a swapped ladder, wrong lane, or a smiling gel.`,
      improvement: "Re-image with the correct ladder lane, and recast the gel if wells distorted (run cooler / lower voltage).",
      learning_point: "Always verify the ladder lane and well geometry before trusting a size call.",
    },
    kinetics: {
      diagnosis: `Your rate is ${d} off — too large to be timing alone; suspect a concentration/volume error in solution A or B.`,
      improvement: "Re-measure each volume, confirm the thiosulfate amount, and repeat the run.",
      learning_point: "Rate depends on reactant concentrations — a pipetting error scales the whole result.",
    },
  };
  return red[domain];
}
