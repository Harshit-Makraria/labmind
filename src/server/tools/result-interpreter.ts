/**
 * Result Interpreter tool (Feature 4) — deviation diagnosis + coaching.
 *
 * Deterministic pedagogical engine, now experiment-aware: titration errors point
 * to parallax/endpoint, gel to ladder interpolation, kinetics to timing. Grades
 * green/amber/red by magnitude and tailors the root cause to magnitude+direction.
 */
import "server-only";
import type { ExpectedResult, InterpretRequest, InterpretResult, ResultSeverity } from "@/lib/types";
import { getExperiment } from "@/server/experiments";
import { gradeResult } from "@/server/tools/expected-result";

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

/**
 * Grade a non-numeric experiment — a microscopy identification, a circuit
 * yes/no, a recorded observation. These have no "percent off", so they get a
 * correct/incorrect (or needs-review) verdict and coaching that talks about the
 * answer rather than about measurement technique.
 */
export function interpretUniversal(expected: ExpectedResult, submitted: { numeric?: number | null; answer?: string | boolean | null }, req: InterpretRequest): InterpretResult {
  // Numeric still flows through the original, experiment-aware coaching engine
  // below — that copy is genuinely good and stays exactly as it was.
  if (expected.kind === "numeric") {
    return interpret({ ...req, theoretical_value: expected.value ?? 0 });
  }

  const outcome = gradeResult(expected, submitted);
  const label = expected.label || "result";

  if (outcome.kind === "none") {
    return {
      deviation_percent: null, correct: null, result_kind: "none", severity: "green",
      diagnosis: "This experiment doesn't record a final measured result — your step-by-step work is the submission.",
      improvement: "Make sure every step's evidence is uploaded and verified.",
      learning_point: "Some practicals are assessed on technique and observation rather than a single final number.",
    };
  }

  if (outcome.kind === "qualitative") {
    return {
      deviation_percent: null, correct: null, result_kind: "qualitative", severity: "amber",
      diagnosis: `Your ${label} has been recorded and sent to your instructor for review. ${outcome.comparison}`,
      improvement: expected.rubric ? `Your instructor is looking for: ${expected.rubric}` : "Be specific about what you actually observed, not what you expected to observe.",
      learning_point: "Written observations are graded on accuracy and detail — describe what was visible, then interpret it.",
    };
  }

  // categorical / boolean — a real right-or-wrong answer.
  const correct = outcome.correct === true;
  return {
    deviation_percent: null,
    correct: outcome.correct,
    result_kind: outcome.kind,
    severity: correct ? "green" : "red",
    diagnosis: correct
      ? `Correct — your ${label} matches the expected answer. ${outcome.comparison}`
      : `Not quite. ${outcome.comparison}`,
    improvement: correct
      ? "Good identification — check that your reasoning matches your observation, not just the answer."
      : `Re-examine your evidence for this step before concluding. Compare what you actually observed against the criteria for each option.`,
    learning_point: correct
      ? "A correct identification is only complete when you can say which observed features led you to it."
      : "An incorrect identification usually traces back to one missed observable feature — find it rather than guessing again.",
  };
}

export function interpret(req: InterpretRequest): InterpretResult {
  const theo = req.theoretical_value;
  const deviation = theo !== 0 ? round1((Math.abs(req.student_result - theo) / Math.abs(theo)) * 100) : 0;
  const severity = grade(deviation);
  const under = req.student_result < theo;
  const exp = getExperiment(req.experiment_id);
  // AUR shares the "chemistry" domain with titration for categorization
  // purposes (it IS a chemistry technique), but a spectrophotometer reading
  // has nothing to do with burettes or endpoints — an experiment-id override
  // gives it its own copy instead of silently inheriting titration's.
  const copy =
    exp.id === "aur-experiment"
      ? aurCopy(severity, under, deviation, req.student_result, req.theoretical_value, req.unit)
      : byDomain(exp.domain, severity, under, deviation, req.student_result, req.theoretical_value, req.unit);
  return { deviation_percent: deviation, correct: null, result_kind: "numeric", severity, ...copy };
}

function aurCopy(severity: ResultSeverity, under: boolean, deviation: number, measured: number, expected: number, unit: string): Copy {
  const d = `${deviation}%`;
  const u = unit ? ` ${unit}` : "";
  const vs = `${measured}${u} vs. an expected ${expected}${u}`;

  if (severity === "green") {
    return {
      diagnosis: `Excellent — ${vs} (${d} off), within the spectrophotometer's precision.`,
      improvement: "Keep cuvettes clean and re-blank between readings to stay this accurate.",
      learning_point: "Beer-Lambert (A = εbc) holds linearly only when cuvettes are clean and consistently oriented.",
    };
  }

  if (severity === "amber") {
    return under
      ? {
          diagnosis: `Your reading is ${vs} (${d} low) — likely a smudged or misoriented cuvette scattering light, or blanking against the wrong reference.`,
          improvement: "Wipe the cuvette's optical faces, re-blank with a fresh reference, and load it in the same orientation each time.",
          learning_point: "Fingerprints and scratches on a cuvette scatter light and bias absorbance readings low.",
        }
      : {
          diagnosis: `Your reading is ${vs} (${d} high) — likely stray light or a cuvette not fully seated in the holder.`,
          improvement: "Close the sample chamber lid fully and confirm the cuvette is seated before reading.",
          learning_point: "An unsealed sample chamber lets ambient light leak in and inflate the absorbance reading.",
        };
  }

  return {
    diagnosis: `Your reading is ${vs} (${d} off) — too large for cuvette handling alone; suspect an un-blanked instrument, the wrong wavelength, or a sample outside the linear range.`,
    improvement: "Re-blank at exactly 540 nm, and if the sample looks strongly coloured, dilute it — Beer-Lambert only holds up to ~2 AU.",
    learning_point: "Above ~2 AU, absorbance stops scaling linearly with concentration — dilute a concentrated sample rather than trusting an out-of-range reading.",
  };
}

function byDomain(
  domain: "chemistry" | "biology" | "kinetics",
  severity: ResultSeverity,
  under: boolean,
  deviation: number,
  measured: number,
  expected: number,
  unit: string,
): Copy {
  const d = `${deviation}%`;
  // Interpolated into every diagnosis below so two different (measured,
  // expected) pairs that happen to land in the same severity/direction
  // bucket don't emit byte-identical text apart from the percent — the
  // student sees their actual numbers, not just a bucketed generality.
  const u = unit ? ` ${unit}` : "";
  const vs = `${measured}${u} vs. an expected ${expected}${u}`;
  if (severity === "green") {
    const green: Record<typeof domain, Copy> = {
      chemistry: {
        diagnosis: `Excellent — ${vs} (${d} off), within experimental error. Your titration technique was sound.`,
        improvement: "Keep reading the meniscus at eye level and record to two decimals to stay this accurate.",
        learning_point: "Concordant titres within ±0.1 mL are the hallmark of good volumetric technique.",
      },
      biology: {
        diagnosis: `Great call — ${vs} (${d} off), within tolerance of the ladder.`,
        improvement: "Run a few more ladder lanes next time to tighten interpolation at the extremes.",
        learning_point: "Migration distance scales with log(size); reading against a ladder is how you stay accurate.",
      },
      kinetics: {
        diagnosis: `Spot on — ${vs} (${d} off), within experimental error.`,
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
          diagnosis: `Your result is ${vs} (${d} below expected) — likely under-titration: stopping before the true endpoint, or a low (parallax) burette reading.`,
          improvement: "Near the endpoint add NaOH dropwise and wait for the pink to persist ~30 s; read at eye level.",
          learning_point: "A faint, permanent pink is the endpoint; a fleeting pink that fades means you're not there yet.",
        },
        {
          diagnosis: `Your result is ${vs} (${d} above expected) — likely overshooting the endpoint past the first permanent pink.`,
          improvement: "Slow to dropwise addition and swirl constantly; the endpoint is a single drop.",
          learning_point: "Past equivalence each extra drop adds error — the endpoint is the first permanent colour, not a deep pink.",
        },
      ],
      biology: [
        {
          diagnosis: `Your estimate is ${vs} (${d} small) — the band likely ran slightly further than you read, or the gel ran long.`,
          improvement: "Interpolate against the two nearest ladder bands and stop the run when the dye front is ~⅔ down.",
          learning_point: "Over-running the gel compresses large fragments and biases size estimates low.",
        },
        {
          diagnosis: `Your estimate is ${vs} (${d} large) — the band may not have migrated far enough, or voltage/time was low.`,
          improvement: "Run at the recommended 100 V for the full time and re-read against the ladder.",
          learning_point: "Smaller fragments travel farther; under-running makes everything look bigger.",
        },
      ],
      kinetics: [
        {
          diagnosis: `Your rate is ${vs} (${d} low) — likely a late stopwatch stop (reacting after the colour, not on it).`,
          improvement: "Watch on a white tile and stop the clock at the very first blue-black flash.",
          learning_point: "Human reaction lag systematically lengthens the measured time and lowers the rate.",
        },
        {
          diagnosis: `Your rate is ${vs} (${d} high) — likely an early stop, or warmer reagents speeding the reaction.`,
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
      diagnosis: `Your result is ${vs} (${d} off) — a large deviation pointing to a systematic error: a misread burette, an unrinsed burette diluting the NaOH, or a slip in n = C×V.`,
      improvement: "Repeat with a freshly rinsed burette, recheck final − initial volume, and recompute C(HCl) = n / 0.025.",
      learning_point: "Large one-directional errors are systematic, not random — find the single step that biased every reading.",
    },
    biology: {
      diagnosis: `Your estimate is ${vs} (${d} off) — that's beyond interpolation error and suggests a swapped ladder, wrong lane, or a smiling gel.`,
      improvement: "Re-image with the correct ladder lane, and recast the gel if wells distorted (run cooler / lower voltage).",
      learning_point: "Always verify the ladder lane and well geometry before trusting a size call.",
    },
    kinetics: {
      diagnosis: `Your rate is ${vs} (${d} off) — too large to be timing alone; suspect a concentration/volume error in solution A or B.`,
      improvement: "Re-measure each volume, confirm the thiosulfate amount, and repeat the run.",
      learning_point: "Rate depends on reactant concentrations — a pipetting error scales the whole result.",
    },
  };
  return red[domain];
}
