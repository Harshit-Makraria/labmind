# LabMind Universal Labs — Making It Work For Every Subject

> **Status: PLAN ONLY. Nothing here has been built.**
> Goal: LabMind works for **any** lab — school or college, chemistry, physics,
> biology, electronics, computer science, engineering, pharmacy, nursing,
> geology, home science — not just the 4 chemistry/biology experiments it
> ships with today.
>
> Written: 2026-08-04. Owner: Team BitX.
> Companion doc: `LIVE_COPILOT_PLAN.md` (do that **after** this one).

---

## 0. Why this comes first

The live co-pilot is a better *interaction model* for a product that currently
only understands burettes. **Generalisation is worth more than any new
interaction.** A live AI proctor that can't verify a physics ammeter or a
Python program is still a chemistry-only product with a nicer UI.

This plan is also **cheaper**, **lower-risk**, and fixes a **live correctness
bug** along the way (§2.1).

---

## 1. Audit findings — what actually blocks universality

Verified by reading the code, not assumed.

### ✅ Already subject-agnostic (keep, don't touch)

| Component | File | Why it generalises |
|---|---|---|
| Protocol/step structure | `lib/types.ts` `ProtocolStep` | title, instructions, duration, safety_flags, expected_observation — nothing chemistry-specific |
| PDF → experiment parsing | `tools/protocol-parser.ts` | works on any text-bearing lab manual |
| Session / join / QR / instructor isolation | `store/*`, route handlers | pure workflow |
| Pacing & integrity analysis | `tools/pacing.ts` | timing physics applies to every lab |
| Duplicate-photo detection | `tools/image-fingerprint.ts` | image-level, subject-blind |
| Audit chain | `tools/audit-chain.ts` | generic append-only log |
| Risk scoring | `tools/risk.ts` | signal-based, no domain knowledge |
| Pre-lab quiz | `tools/prelab-quiz.ts` | AI-generated from any protocol |
| Reports, accuracy, exports | `store/accuracy.ts` etc. | generic |

**That's ~70% of the product already universal.** The blockers are concentrated
in five places.

### 🔴 Blocker 1 — Only 4 vision check types exist

```ts
// lib/types.ts:8
export type VisionCheckType = "burette_reading" | "colour_change" | "gel_band" | "absorbance";
```

Each has a hand-written prompt in `vision-check-flow.ts` (`CHECK_INSTRUCTIONS`)
and hard-coded physics in `instrument-spec.ts`. **Cannot verify:** ammeter,
voltmeter, vernier caliper, micrometer, spring balance, thermometer, pH meter,
microscope field, pendulum, circuit board, weighing balance, stopwatch,
titration in any other glassware, dissection tray, plant/tissue slide,
terminal output, code editor, oscilloscope, multimeter…

**This single limit excludes most of physics, most of biology, and all of
computer/engineering labs.**

### 🔴 Blocker 2 — Custom PDFs have no expected result *(live bug)*

`Protocol` carries only `experiment_name` + `steps`. There is no `theoretical`
field. So:

```ts
// api/[[...route]]/route.ts:550
const theoreticalValue = getExperiment(experimentId).theoretical.value;
```

An instructor who uploads a **redox titration** PDF has their students graded
against **acid-base titration's 0.1 mol/L**. Every deviation %, every accuracy
score, every report figure for a custom experiment is currently **wrong**.
This is a correctness bug affecting a shipped feature, not just a gap.

### 🔴 Blocker 3 — Domain enum is a closed set of 3

```ts
export type ExperimentDomain = "chemistry" | "biology" | "kinetics";
```

`result-interpreter.ts` hand-writes coaching copy per domain. A physics
experiment falls into `chemistry` and gets told to "re-read the meniscus at eye
level" — actively wrong, and it looks unserious to a physics teacher.

### 🔴 Blocker 4 — Safety engine is purely chemical

`data/reagent-safety.ts`: 22 reagent-conflict pairs + molarity thresholds.
No model of: electrical hazard, mains voltage, laser/UV/radiation, biohazard/
pathogen, sharps, heat/cryogenics, pressure/vacuum, mechanical/rotating parts,
ergonomic/RSI (computer labs), or data-safety.

### 🔴 Blocker 5 — The parser prompt is literally chemistry-scoped

```ts
const PROMPT = `You are a chemistry lab protocol parser. …
vision_expected.type must be one of: "burette_reading", "colour_change", "gel_band", "absorbance".`;
```

Even with a perfect physics PDF, the parser is instructed to force every check
into one of four chemistry shapes.

### 🟡 Minor

- `EXPERIMENT_LABELS` in `vision-check-flow.ts` hardcodes the 4 experiment ids
  (already has a sane fallback — low risk).
- `ResultEntry.tsx` titration triplicate logic is gated on
  `experiment_id === "acid-base-titration"` — correct today, but the gate should
  become capability-driven (§4.6).
- Demo-mode vision (`vision.ts`) has per-type jitter tables keyed to the 4 types.

### 🟢 Good news — the seams already exist

- `buildCheckInstruction()` **already has a generic fallback branch** for
  unknown check types. The extension point is built.
- `instrumentFor()` **already returns `null`** for types with no fixed scale
  (`colour_change`), and `physical-constraints.ts` already handles a null spec.
- The provider layer, ensemble, quality gate, and crop stages are all
  type-agnostic — they operate on pixels, not on chemistry.

**We are extending an architecture that anticipated this, not fighting one that
didn't.**

---

## 2. The core design decision

> **Stop enumerating instruments. Start describing evidence.**

Today: a fixed list of instruments the developer taught the system to read.
Target: the **instructor describes in plain language what the photo must show**,
and the AI judges the photo against that description — with the deterministic
physics layer applied *only when* a known instrument is declared.

This is the same feature you already asked for on the manual step-builder
("for image part, description of what's needed"). It is the single highest-
leverage change in this document: it unlocks **every subject at once**, and it
requires no per-subject engineering.

### The new check model

```ts
export type VisionCheckKind =
  | "instrument_reading"   // numeric value from a scale/display (generic!)
  | "visual_state"         // qualitative: colour, precipitate, band, growth, setup correctness
  | "setup_verification"   // "is the apparatus assembled correctly?"
  | "artifact_capture"     // screenshot/code/output (computer & engineering labs)
  | "specimen_observation" // microscopy, dissection, plant/tissue
  | "measurement_evidence" // a written reading, a stopwatch, a logbook entry
  | "none";

export interface VisionExpectedV2 {
  kind: VisionCheckKind;

  /** THE KEY FIELD — instructor's plain-language description of what must be visible. */
  description: string;          // "The ammeter needle should read between 0.4 and 0.6 A"

  /** Optional numeric target — present for readings, absent for qualitative checks. */
  expected_value?: number | null;
  tolerance?: number | null;
  unit?: string | null;

  /** Optional: declare a KNOWN instrument to unlock deterministic physics checks. */
  instrument?: string | null;   // "burette_50ml" | "ammeter_1a" | "vernier_caliper_150mm" | …

  /** Qualitative acceptance criteria — for visual_state / setup / specimen. */
  must_show?: string[];         // ["needle deflected right", "circuit closed"]
  must_not_show?: string[];     // ["needle pegged at maximum", "loose crocodile clip"]
}
```

**Backwards compatibility is mandatory.** The 4 existing types keep working
verbatim — see §3.

---

## 3. Migration strategy (zero breakage)

### 3.1 Adapter, not replacement

Keep `VisionCheckType` (the old 4) as a **legacy alias set**. Add
`VisionExpectedV2` alongside. A single normaliser maps old → new:

```ts
// tools/vision-expected-adapter.ts  (NEW FILE)
function toV2(old: VisionExpected): VisionExpectedV2 {
  const map = {
    burette_reading: { kind: "instrument_reading", instrument: "burette_50ml", unit: "mL",
      description: "The burette's liquid level (bottom of the meniscus) against the printed scale." },
    gel_band:        { kind: "instrument_reading", instrument: "gel_band", unit: "bp", … },
    absorbance:      { kind: "instrument_reading", instrument: "spectrophotometer", unit: "AU", … },
    colour_change:   { kind: "visual_state", description: "The colour of the reaction mixture …" },
  };
  return { ...map[old.type], expected_value: old.expected_value, tolerance: old.tolerance };
}
```

Every existing experiment, every stored `customProtocol` JSON, and every
in-flight session keeps working with **no data migration**. The 110 existing
tests must stay green — that's the acceptance gate.

### 3.2 Prompt building becomes composed, not enumerated

`buildCheckInstruction()` today does a lookup in a 4-entry table with a
fallback. New version composes from the V2 object:

```
[role: forensic observer, report only what's visible]
[context: experiment name, step number, subject domain]
[what to look for: <instructor's description verbatim>]
[if numeric: report the value + the nearest scale labels above/below]
[if qualitative: report must_show / must_not_show findings individually]
[return schema — same JSON shape as today, so parsing is unchanged]
```

Crucially, **`BLIND_READING_SYSTEM` stays exactly as-is** — never tell the model
the expected value. That anti-anchoring rule is one of the strongest parts of
the current design (it's why a 6 mL burette stopped being "read" as 24.5 mL)
and it generalises perfectly.

### 3.3 Deterministic physics stays — it just becomes optional

`physical-constraints.ts` + `instrument-spec.ts` are a genuine differentiator:
zero-AI validation that a reading is physically possible. Keep them, and make
the instrument registry **data-driven and extensible**:

```ts
// instrument-registry.ts (NEW — replaces the hardcoded if-chain)
export const INSTRUMENTS: Record<string, InstrumentSpec> = {
  burette_50ml:        { granularity: 0.1,  min: 0,   max: 50,   unit: "mL", scaleDirection: "down" },
  measuring_cylinder_100ml: { granularity: 1, min: 0, max: 100,  unit: "mL" },
  ammeter_1a:          { granularity: 0.02, min: 0,   max: 1,    unit: "A" },
  voltmeter_15v:       { granularity: 0.1,  min: 0,   max: 15,   unit: "V" },
  vernier_caliper_150mm: { granularity: 0.02, min: 0, max: 150,  unit: "mm" },
  micrometer_25mm:     { granularity: 0.01, min: 0,   max: 25,   unit: "mm" },
  thermometer_110c:    { granularity: 1,    min: -10, max: 110,  unit: "°C" },
  spring_balance_10n:  { granularity: 0.1,  min: 0,   max: 10,   unit: "N" },
  ph_meter:            { granularity: 0.01, min: 0,   max: 14,   unit: "pH" },
  stopwatch:           { granularity: 0.01, min: 0,   max: 3600, unit: "s" },
  weighing_balance_200g: { granularity: 0.001, min: 0, max: 200, unit: "g" },
  // …grows over time; unknown instrument → null spec → AI-only check (still works)
};
```

**An unknown instrument degrades gracefully to an AI-only check** — exactly how
`colour_change` already behaves. No new failure mode.

---

## 4. Subject-by-subject coverage plan

### 4.1 Chemistry ✅ (works today, gets better)
Add: measuring cylinder, pipette, weighing balance, pH meter, thermometer,
melting-point apparatus, conductivity meter, chromatography plate (Rf as a
`visual_state` + measured distances).

### 4.2 Physics 🔴 → ✅
`instrument_reading` + registry entries: ammeter, voltmeter, multimeter,
vernier caliper, micrometer screw gauge, spring balance, travelling microscope,
spherometer, thermometer, stopwatch, protractor/optical bench scale.
`setup_verification`: circuit wiring correct, pendulum mounted, lens/screen
alignment on the optical bench.
Result types: resistance, focal length, `g`, Young's modulus, refractive index.

### 4.3 Biology 🟡 → ✅
`specimen_observation`: microscope field (identify tissue/cell type/stage),
dissection stages, prepared slides, plant/animal specimen identification.
`visual_state`: bacterial growth/plating, staining outcome, germination.
Note: outcomes here are **qualitative** — the deviation model must accept
non-numeric results (§4.7).

### 4.4 Computer Science / Programming labs 🔴 → ✅ *(genuinely new capability)*
This is the biggest new market and needs its own handling because **there is no
physical instrument**:
- `artifact_capture`: screenshot of terminal output, IDE, compiler result, SQL
  query result, browser render, network diagram, database schema.
- New optional **text-artifact** path: student pastes/uploads **code or output
  text** instead of a photo. Verification compares against the expected
  behaviour the instructor described. This reuses `completeJSON`, not vision —
  **cheaper than a photo check**.
- Steps become: write the function → run it → capture output → explain result.
- **Do not** attempt automatic code execution in v1. Judge the *submitted
  evidence*, not a sandboxed run. Sandboxed execution is a separate, much larger
  security project.

### 4.5 Engineering / Electronics / Mechanical 🔴 → ✅
`setup_verification` (breadboard wiring, apparatus assembly),
`instrument_reading` (oscilloscope, function generator, multimeter, CRO traces),
`artifact_capture` (CAD screenshot, simulation output, waveform).

### 4.6 Other labs that fall out for free
Pharmacy (dissolution, weighing), Nursing (procedure `setup_verification`),
Geology (specimen identification), Home Science/Nutrition, Psychology
(apparatus + observation records), Civil (slump test, sieve analysis),
Language labs (audio artifact — future).

### 4.7 Non-numeric results — the model must accept them

Today the result pipeline assumes a single number (`deviationPercent: Float?`).
Many labs don't produce one: "identify the tissue", "which species is this",
"does the circuit work", "does the program compile".

Add a **result type** to the protocol:

```ts
type ResultKind = "numeric" | "categorical" | "boolean" | "qualitative" | "none";

interface ExpectedResult {
  kind: ResultKind;
  label: string;                  // "Focal length" | "Tissue type" | "Program output"
  value?: number | null;          // numeric
  unit?: string | null;
  options?: string[];             // categorical: ["cardiac","skeletal","smooth"]
  correct?: string | string[];    // categorical/qualitative answer key
  tolerance?: number | null;
  rubric?: string;                // qualitative: how an AI/instructor should grade it
}
```

`deviationPercent` remains for numeric results; categorical/boolean produce a
**correct/incorrect** outcome; qualitative produces an **AI-graded rubric score
with instructor override**. All three feed the same report/accuracy machinery.

**This is what makes the triplicate-titration gate capability-driven** — that
UI shows when `expected_result.kind === "numeric" && capabilities.replicates`,
not when `experiment_id === "acid-base-titration"`.

---

## 5. Safety, generalised

Replace "chemical conflicts only" with a **hazard-category model**. Keep the
existing 22 chemical rules verbatim as one category — they're good, and they're
already tested.

```ts
type HazardCategory =
  | "chemical" | "electrical" | "thermal" | "mechanical" | "radiation"
  | "biological" | "sharps" | "pressure" | "cryogenic" | "ergonomic" | "data";

interface HazardRule {
  category: HazardCategory;
  trigger: { reagents?: string[]; equipment?: string[]; conditions?: string[] };
  severity: Severity;
  description: string;
  action: string;
}
```

Examples to seed:
- **electrical**: mains voltage + wet bench; exposed conductor; >50 V DC;
  shorting a supply; capacitor discharge.
- **thermal**: open flame + flammable solvent; hot plate unattended; glassware
  thermal shock.
- **radiation**: UV transilluminator without shield (already relevant to the
  existing gel experiment); laser without goggles; X-ray/radioactive source.
- **biological**: culture handling, BSL levels, sharps + biological material.
- **mechanical**: rotating machinery + loose clothing/hair; unguarded press.
- **pressure/cryogenic**: vacuum glassware implosion; LN₂ in a sealed vessel.
- **ergonomic/data** (computer labs): screen-break guidance; unsafe code
  practices (hardcoded credentials, `rm -rf`, running untrusted scripts, SQL on
  production). Yes — a CS lab has real safety rules, they're just not chemical.

**Non-negotiable rule (carried from `LIVE_COPILOT_PLAN.md`):** safety rules stay
human-authored and version-controlled. The AI may *explain* a rule; it may never
*invent* or *retire* one.

---

## 6. Parser upgrade — subject-aware, not chemistry-locked

New parser prompt outline:

1. **Detect the subject/domain first** from the manual text.
2. Extract steps with the same `ProtocolStep` shape (unchanged).
3. For each step, decide `vision_expected` using the **V2 model**, writing a
   plain-language `description` — the model is good at this, it's just never
   been asked.
4. Map to a known `instrument` id **only when confident**; otherwise leave null
   (graceful AI-only check).
5. Extract the **expected result** (`ExpectedResult`) — this is what fixes
   Blocker 2.
6. Extract hazards and tag them by `HazardCategory`.

Add a **confidence + review** step: the parser returns `needs_review: true` on
any step it wasn't confident about, and the instructor sees those highlighted in
the manual step-builder (§7) before publishing. **Never silently guess at a
safety flag or an expected value.**

---

## 7. Manual step-builder (also fixes the earlier request)

The instructor UI must be able to author everything above by hand — for when
there is no PDF, or when the parse needs correcting:

- Add/reorder/delete steps; edit title, instructions, duration, reagents.
- Per step: toggle photo requirement → pick a **check kind** → write the
  **plain-language description of what the photo must show** → optionally pick a
  known instrument from the registry → set expected value/tolerance or
  must_show/must_not_show.
- Set the experiment's **expected result** (kind + value/options/rubric).
- Add safety flags with a hazard category.
- **Preview as a student** before publishing.
- Save as a **reusable template** for the department (see §9).

This is the same feature requested earlier ("build experiment steps manually
like in Tally, and for the image part a description of what's needed") — it is
folded in here because it is the *authoring surface* for universality. Without
it, instructors can't use any of the new capability.

---

## 8. Data model changes

All additive. No destructive migration.

```prisma
model InstructorSession {
  // existing…
  customProtocol Json?     // already exists — schema inside it evolves (versioned)
}
```

Add `protocol_version: 2` inside the JSON so old and new shapes coexist and the
adapter (§3.1) knows which path to take. **No column changes to existing
tables** — same isolation principle as the co-pilot plan.

New optional columns on `LabSession` for non-numeric results:
```prisma
resultKind      String?   // "numeric" | "categorical" | "boolean" | "qualitative"
resultValueText String?   // for non-numeric outcomes
resultCorrect   Boolean?  // for categorical/boolean grading
// deviationPercent stays for numeric — unchanged, nothing breaks
```

New table for the department template library (§9):
```prisma
model ExperimentTemplate {
  id            String   @id @default(cuid())
  ownerUserId   String?
  institution   String?
  subject       String
  name          String
  protocol      Json
  isPublic      Boolean  @default(false)
  usageCount    Int      @default(0)
  createdAt     DateTime @default(now())
  @@index([subject])
  @@index([ownerUserId])
}
```

---

## 9. Template library — the scaling play

Once instructors can author universal experiments, let them **share** them:
- Save any experiment as a template (private → department → public).
- Browse by subject/class-level/board (CBSE/ICSE/State/University).
- Fork and adapt someone else's.
- Track usage; surface the most-used per subject.

This converts a per-instructor authoring cost into a **network effect**, and it
is the strongest answer to "does this scale beyond one teacher?" — a real
business-model point for the pitch, not just an engineering one.

Seed it with NCERT/CBSE Class 11–12 Physics, Chemistry and Biology practicals so
the library is non-empty on day one. (The NCERT redox-titration PDF already
tested against the parser is a natural first seed.)

---

## 10. Phasing

### Phase 0 — Correctness fix *(do immediately, tiny, high value)*
- Add `theoretical`/`ExpectedResult` to `Protocol`; make `/results/interpret`
  read the custom protocol's own expected value with the library value as
  fallback. **Fixes a live bug** (Blocker 2).
- ~1 file + 1 route change. Independently shippable.

### Phase 1 — Generic vision check *(the unlock)*
- `VisionExpectedV2` + adapter + composed prompt builder.
- Instrument registry (data-driven), degrading gracefully to AI-only.
- Keep all 4 legacy types working; 110 tests stay green.
- **After this phase, every subject technically works.**

### Phase 2 — Manual step-builder + description authoring
- Full authoring UI (§7). Without this, Phase 1 is only reachable via PDF.

### Phase 3 — Domains, results, safety generalisation
- Open the domain enum; `ResultKind`; hazard categories; domain-aware coaching
  copy in `result-interpreter.ts`.

### Phase 4 — Computer-lab support
- `artifact_capture` + text-artifact submission path (no sandboxed execution).

### Phase 5 — Parser upgrade
- Subject detection, V2 output, `needs_review` flags.

### Phase 6 — Template library
- Save/share/fork; seed with NCERT practicals.

**Only then**: `LIVE_COPILOT_PLAN.md`.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Breaking the working chemistry flow** | Adapter pattern (§3.1), legacy types preserved verbatim, 110 tests as the gate, `protocol_version` discriminator. |
| **Generic checks are less accurate than hand-tuned ones** | Keep deterministic physics for known instruments; generic path is a *floor*, not a replacement. Measure per-kind accuracy via existing `accuracy.ts` before claiming parity. |
| **Instructors write vague descriptions** → poor verification | In-UI guidance + examples per check kind; parser-suggested descriptions the instructor edits rather than writes cold; `needs_review` flagging. |
| **Safety rules wrong for an unfamiliar subject** | Never AI-generate safety rules. Human-authored per category; unknown subject = show generic PPE guidance + instructor-authored flags only. |
| **Scope explosion** | Phase 0 and Phase 1 are independently valuable and independently shippable. Stop after either if time runs out. |
| **Non-numeric results break existing reports** | `deviationPercent` untouched for numeric; new fields are nullable; report UI branches on `resultKind`. |
| **Computer labs invite "run the code"** | Explicitly out of scope in v1 — judge submitted evidence only. Sandboxed execution is a separate security project. |

---

## 12. Success criteria

- An instructor can upload a **physics** practical PDF and get a working,
  photo-verified experiment with correct expected values.
- An instructor can build a **computer lab** experiment manually where students
  submit terminal output instead of photos.
- A **biology** microscopy experiment grades a categorical answer correctly.
- All 4 existing chemistry/biology experiments behave **identically** to today.
- 110 existing tests green; new tests per check kind.
- Custom-PDF deviation figures are correct (Blocker 2 closed).

---

## 13. Recommended immediate action

**Phase 0 alone** — adding a real expected result to custom protocols — is a
small change that fixes wrong numbers currently shown to students and
instructors for every custom experiment. It's worth doing before the Grand
Finale regardless of everything else in this document.

Phases 1–2 are the real product unlock and should start **after** the Finale,
unless there is comfortable time.
