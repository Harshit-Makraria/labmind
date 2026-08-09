# LabMind — Engineering Session Log

> A record of the working session that produced commits `5d99381`, `07435a8`
> and `0041a60`, plus the two planning documents in this folder.
>
> Team BitX · Capgemini Exceller AgentifAI Buildathon 2026
> Session date: 2026-08-04 → 2026-08-06

**Scope note.** This log covers the conversation and work as a technical record:
what was asked, what was found, what was decided and why, and how each change
was verified. Two deliberate exclusions, since this repository is public:

- The buildathon's internal event-logistics email (venue, accommodation and
  travel arrangements) is summarised, not reproduced.
- Personal contact details are omitted.

An earlier portion of the session was compacted before this log was written, so
the first entries below are reconstructed from that summary rather than quoted
verbatim. Everything from §3 onward is a direct record.

---

## 1. Earlier work (reconstructed from the compacted summary)

Work completed before this log begins:

| Area | Outcome |
|---|---|
| Session persistence | 30-day NextAuth JWT sessions, sliding on activity |
| **Instructor data isolation** | Instructors could see *every* student's data across the whole system. Scoped every instructor-facing query to `{OR: [{createdByUserId}, {code: DEMO_INSTRUCTOR_CODE}]}`. Re-audited later and found two further leaks (`/instructor/accuracy`, `/dashboard/decisions`). |
| Mobile polish | Bottom-nav column widths, wrap-safe topbar, three tables that silently clipped data on mobile now scroll |
| Compliance | Privacy Policy, Terms of Service, security headers, data export, account deletion (GDPR / India DPDP-aligned) |
| Profile pages | Role-aware overview for students and instructors |
| **PDF → experiment** | The AI parsed an uploaded PDF then discarded everything except the experiment name. Every student got the generic library protocol. Fixed by persisting the parsed protocol on `InstructorSession.customProtocol` and propagating it through join. Also fixed a second bug found on the way: every upload created a permanently orphaned DB row. |

A recurring constraint established early and honoured throughout: **local dev
and production share the same Supabase database**, so any account or session
created during live verification is a real production mutation and must be
explicitly cleaned up afterwards.

---

## 2. Presentation and demo materials

Requested and produced alongside the engineering work:

- **Demo video script** — timestamped, with on-screen actions and voiceover,
  delivered as `deliverables/LabMind-Demo-Video-Script.docx`. Revised twice: a
  stronger cold open, then expanded to match the fuller walkthrough actually
  being recorded (including the deliberate blurry-photo failure and the
  intentionally wrong final result — both good, because they prove the AI
  checks are real rather than staged).
- **Solution Snapshot** (300–500 words) — rewritten to be dash-free and
  grounded in the four experiments actually shipped.
- **Slide guidance** — 5 slides, team name as a title-slide footer.

**Honest note given at the time:** narration for the full walkthrough runs
~2:10 spoken, but real UI wait time pushes the recorded video to 3.5–5 minutes,
not the 2:30–3:00 target. The condensed cut is the one that fits the 8-minute
stage cap.

---

## 3. Bug: titration reported 24,690% deviation

**Reported:** the report and averages showed a ~24,690% deviation.

**Root cause.** For the titration flow, students enter three titre readings in
**mL** (~24–25). The app submitted the raw mean titre volume directly as the
result and compared it against the theoretical answer of **0.1 mol/L** — a
different physical quantity entirely. It never ran the stoichiometry the
protocol's own step 6 describes.

```
((24.79 − 0.1) / 0.1) × 100 = 24,690%
```

which matched the reported number exactly.

**Fix.** `C(HCl) = C(NaOH) × V(NaOH) / V(HCl)` is now applied before submission,
and the calculated concentration is shown in the UI so students see the number
actually being graded.

**Verified live:** the same 24.79 mL mean now yields **0.0992 mol/L → 0.8%
deviation** ("Excellent"). Because deviation is stored per session, this one fix
corrected every downstream average too.

Commit `5d99381`.

---

## 4. Audit: is the product actually universal?

Asked to check, before building anything further, whether LabMind worked for
every subject. It did not. Findings, verified by reading the code:

**Already subject-agnostic (~70% of the product):** protocol/step structure, PDF
parsing, sessions/join/QR, instructor isolation, pacing analysis, duplicate-photo
detection, audit chain, risk scoring, pre-lab quiz, reports.

**Five hard blockers:**

1. **Only four vision check types existed** — `burette_reading`, `colour_change`,
   `gel_band`, `absorbance`. Each had a hand-written prompt and hardcoded
   instrument physics. Nothing else could be verified at all: no ammeter,
   caliper, microscope, circuit, balance, thermometer, or screenshot. This alone
   excluded most of physics, much of biology, and all computer/engineering labs.
2. **Custom PDFs had no expected result** *(a live bug)* — `Protocol` carried
   only `experiment_name` and `steps`, so `route.ts` graded every custom
   experiment against `getExperiment(id).theoretical`, the **library** value.
3. **Domain enum closed to three** — `chemistry | biology | kinetics`.
4. **Safety engine purely chemical** — 22 reagent pairs, no electrical, thermal,
   radiation, biological, mechanical or data hazards.
5. **Parser prompt literally chemistry-scoped.**

**Good news recorded at the time:** the architecture had anticipated this.
`buildCheckInstruction()` already had a generic fallback branch, `instrumentFor()`
already returned `null` for scale-less checks, and `physical-constraints.ts`
already handled a null spec. The work was extending existing seams, not fighting
the design.

Written up as `docs/UNIVERSAL_LABS_PLAN.md`.

---

## 5. Live AI co-pilot — planned, deliberately not built

Explored the idea of the agent joining a student on a live call rather than
exchanging photos.

**Assessment.** Technically buildable with realtime multimodal APIs, but the
naive version costs roughly **$150–$400 per 30-student class** versus ~$1–$3
today, because realtime APIs bill continuously — including silence.

**Cost levers identified:** escalation instead of always-on (reusing the
`risk.ts` / `pacing.ts` / `vision_attempts` signals the app *already* computes);
assembling STT → cheap text model → TTS instead of buying the bundled premium
API; push-to-talk; two-stage frame gating with perceptual-hash dedupe;
critical-window scoping; hard ceilings enforced in code; prompt caching.
Projected: **~$3–$8 per class** instead of $150–$400.

**Two findings worth keeping:**
- `next.config.ts` sets `Permissions-Policy: microphone=()`, which blocks the
  microphone outright. Voice cannot work until that changes — a real blocker,
  not a hypothetical.
- The self-learning story already has a working seed: `store/accuracy.ts`
  already treats every instructor approve/reject as a labelled data point about
  whether the AI was right, and `risk.ts` already computes per-student
  thresholds. Connecting the two is genuine self-calibration built on data
  already collected.

**Recommendation given and accepted:** keep this as a roadmap slide. Phase 1 (a
*triggered text* co-pilot) delivers ~70% of the value at zero incremental API
cost and near-zero risk. Written up as `docs/LIVE_COPILOT_PLAN.md`, with total
file isolation and a one-commit revert path, so it can never destabilise the
working product.

---

## 6. Universal expected results

Fixed blocker 2, built universally rather than as a narrow patch.

**The bug:** an instructor uploading a redox-titration PDF (real answer
0.02 mol/L) had students graded against acid-base titration's 0.1 mol/L — a
*correct* result reported as ~80% off, red.

**The generalisation:** grading assumed every experiment ends in a float. Added
`ResultKind`:

| Kind | Example | Graded as |
|---|---|---|
| `numeric` | concentration, focal length | percent deviation |
| `categorical` | which tissue, which species | correct / incorrect |
| `boolean` | does the circuit work | correct / incorrect |
| `qualitative` | written observation | **instructor review — never auto-graded** |
| `none` | assessed on steps alone | no grade |

**Two deliberate calls:**
- Qualitative answers are *not* auto-graded. A keyword match would produce a
  confident wrong verdict, which is worse than an honest "needs review."
- Non-numeric results store `null` deviation, not `0`. A fake 0% would have made
  every microscopy session look like a perfect score and poisoned class averages.

**Verified live:** redox protocol graded 0.5% (not 80%); categorical microscopy
protocol returned correct/incorrect with `null` deviation confirmed in the
database. 131 tests passing (110 existing + 21 new).

Commit `07435a8`.

---

## 7. Universality delivered

Fixed blockers 1, 3 and 5.

### 7.1 Universal vision check

New `"descriptive"` check type. The instructor writes, in plain language, what
the photo must show, plus optional `must_show` / `must_not_show` criteria. The
model **observes and reports**; the **server decides** pass/fail from those
observations.

**The anti-anchoring rule was preserved and tested.** The model is still never
told the expected numeric value, even on descriptive checks — that discipline is
why a 6 mL burette stopped being "read" as 24.5 mL, and a regression test now
asserts the target never appears in the prompt.

The four hand-tuned instrument readers and their deterministic physics
validation are untouched.

### 7.2 Manual experiment builder

A third authoring mode beside Library and Upload PDF. Instructors build an
experiment step by step — title, instructions, duration, safety flags, the
per-step photo description, and the final expected result. This is the surface
that makes universality reachable without a PDF.

### 7.3 Subject-neutral coaching

Caught during live verification and worth recording as a near-miss: the physics
experiment was being told **"your titration technique was sound"** and to
**"read the meniscus at eye level."** Custom experiments now receive
measurement-general coaching (systematic vs. random error, repeatability) and
honour their own declared tolerance. Library experiments keep their original
expert copy. A test now fails if chemistry vocabulary leaks into custom feedback.

### 7.4 Two smaller fixes

- `PhotoCapture` defaulted to `burette_reading` when a step declared no vision
  spec — silently asking the AI to read a burette for a physics circuit. Now
  falls back to a descriptive check built from the step's own expected
  observation.
- The parser emits descriptive checks for any subject and falls back to the
  step's `expected_observation` rather than silently dropping verification.

**Verified end-to-end in the browser:** built an Ohm's Law experiment entirely by
hand (no PDF, no chemistry), joined as a student, ran the descriptive photo check
— AI reported *"All required features observed: ammeter reading visible;
voltmeter reading visible; switch closed"* — confirmed failures are genuinely
reachable, and graded the result against its own 4.7 Ω target with no chemistry
advice. 140 tests passing, build clean, all test data removed.

Commit `0041a60`.

---

## 8. Working practices held throughout

- **Deploy only via `git push origin master:main`** — never the Vercel CLI.
- **Stop the dev server before `npm run build`** on Windows; building while
  `next dev` runs corrupts `.next`.
- **Verify with real API/browser calls**, not assumptions — several bugs in this
  session were only visible in a live response.
- **Clean up every test artefact.** Local dev writes to the production database,
  so every throwaway account, session and instructor code created during
  verification was deleted afterwards and the deletion confirmed.
- **Report honestly.** Where something could not be verified, that was stated
  rather than glossed.

---

## 9. Known limitation at time of writing

`OPENAI_API_KEY` and `GEMINI_API_KEY` are present but **empty** in the local
`.env`. This is why the app runs in demo mode: AI checks are simulated and PDF
parsing falls back to the library experiment.

The consequence is precise and worth stating plainly: **the plumbing is verified
correct; the AI's real-world reading quality is not.** Every pipeline described
above was tested end-to-end, but no live model has yet read a real physics meter
or a real lab manual through this system. That requires a working provider key.

---

## 10. Remaining roadmap

From `docs/UNIVERSAL_LABS_PLAN.md`, not yet built:

1. Generalise the safety engine beyond chemical hazards (electrical, thermal,
   radiation, biological, mechanical, data).
2. Open the domain enum past `chemistry | biology | kinetics`.
3. Computer-lab support: text-artifact submission (code / terminal output)
   verified via `completeJSON` rather than vision. Sandboxed execution is
   explicitly out of scope — it is a separate security project.
4. Instrument registry as data, so known instruments unlock deterministic
   physics checks without new code.
5. Department template library, seeded with NCERT practicals.
6. Then, and only then, the live co-pilot (`docs/LIVE_COPILOT_PLAN.md`).
