# LabMind Live Co-Pilot — Detailed Build Plan

> **Status: PLAN ONLY. Nothing in this document has been built.**
> Target: a live, agentic AI lab monitor that acts like a 1:1 human proctor on a
> call — instead of the student uploading a photo per step and waiting.
>
> Written: 2026-08-04. Owner: Team BitX.

---

## 0. The idea in one paragraph

Today LabMind is **turn-based**: the student does a step, takes a photo, uploads
it, the AI answers, repeat. The proposed feature is **continuous**: the AI is
"on the call" — watching the bench through the camera, hearing the student, and
speaking back — so it behaves like an instructor standing next to them rather
than a form they submit to.

The engineering problem is not "can we do it" (we can). It is **cost and blast
radius**. A naive always-on implementation costs ~50–100× per session and, if
built inside the current code paths, can break the working product 6 days
before the Grand Finale. This plan solves both.

---

## 1. Non-negotiable constraints

| # | Constraint | Why |
|---|---|---|
| C1 | **Zero risk to the current system.** If the co-pilot fails, breaks, or costs too much, we flip one flag and everything works exactly as it does today. | The current build is demo-ready and already deployed. It must stay that way. |
| C2 | **Additive only.** No edits to existing hot-path files (`vision.ts`, `vision-check-flow.ts`, `session-store.ts`, the `/api/[[...route]]` handlers that already work). New code lives in new files. | Any regression here is a regression in the thing we're actually presenting. |
| C3 | **Cost-bounded by construction.** It must be impossible for a runaway loop to burn budget — hard ceilings enforced in code, not in discipline. | Realtime APIs bill per minute continuously. A forgotten open session = a bill. |
| C4 | **Degrades to the current flow.** If the live session can't start (no key, no mic permission, quota exhausted, bad network), the student silently gets today's photo-upload flow. Never a dead end. | Lab Wi-Fi is unreliable; a hard failure mid-experiment is worse than no feature. |
| C5 | **Reversible in one commit.** Feature lives behind a flag + a separate route tree, so `git revert` of a single merge removes it entirely. | See C1. |

---

## 2. Isolation strategy (this is the most important section)

### 2.1 Physical separation — new files only

```
src/server/copilot/                 ← ALL new server logic lives here
├── session-manager.ts              live session lifecycle + hard budget ceilings
├── escalation.ts                   decides WHEN to go live (the cost lever)
├── realtime-provider.ts            provider abstraction (mirrors llm/provider.ts)
├── cheap-pipeline.ts               STT → text model → TTS (the budget path)
├── frame-gate.ts                   client+server frame filtering before any AI call
├── copilot-agent.ts                the agentic loop (plan → act → observe → re-plan)
├── memory.ts                       episodic + semantic memory store
├── learning.ts                     offline self-improvement jobs
└── types.ts                        all co-pilot types, imported by nothing else

src/app/(app)/lab/[sessionId]/copilot/page.tsx     ← new route, not touched by existing pages
src/components/copilot/                            ← new components only
src/app/api/copilot/[[...route]]/route.ts          ← SEPARATE Hono app, not the existing one
```

**Rule: no existing file gains co-pilot logic.** The only permitted edits to
existing files are listed in §2.3 and are all one-line, flag-guarded additions.

### 2.2 The kill switch

```ts
// src/server/copilot/config.ts
export const COPILOT_ENABLED = process.env.COPILOT_ENABLED === "true";
export const COPILOT_MAX_MINUTES_PER_SESSION = Number(process.env.COPILOT_MAX_MIN ?? 5);
export const COPILOT_MAX_MINUTES_PER_CLASS_DAY = Number(process.env.COPILOT_MAX_MIN_DAY ?? 60);
export const COPILOT_MAX_CONCURRENT = Number(process.env.COPILOT_MAX_CONCURRENT ?? 3);
```

- `COPILOT_ENABLED=false` (the default, and the value in production until we're
  confident) means: the route returns 404, the UI entry point never renders, no
  provider is ever constructed. The feature is *inert*, not just hidden.
- Flipping it off requires **no deploy** if we read it from `AppSetting` (the
  existing runtime-config table) instead of env — recommended, so we can kill it
  mid-demo from the Settings page if it misbehaves on stage.

### 2.3 The complete list of permitted edits to existing files

These are the *only* changes outside `copilot/`. All are additive and flag-guarded:

1. **`next.config.ts`** — `Permissions-Policy` currently reads
   `camera=(self), microphone=()`. **`microphone=()` blocks the mic outright**,
   so voice cannot work until this becomes `microphone=(self)`. This is a
   genuine blocker discovered during planning, not a hypothetical.
2. **`prisma/schema.prisma`** — new models only (§6). No column changes to
   `LabSession`, `VerificationEntry`, etc. New tables cannot break old queries.
3. **One nav/CTA entry point** — a single flag-guarded button on the lab step
   page: `{COPILOT_ENABLED && <LiveCopilotButton/>}`.
4. **`.env.example`** — document the new vars.

Nothing else. If a change seems to require touching `vision.ts` or
`session-store.ts`, that's a signal to re-scope, not to make the edit.

### 2.4 Rollback procedure (written before we need it)

1. Set `COPILOT_ENABLED=false` in Vercel env → redeploy (or flip the `AppSetting`
   row, no deploy). Feature gone in <60s.
2. If code-level revert needed: `git revert <merge-sha>` — everything is in one
   merge commit on a `feat/live-copilot` branch, never committed directly to
   `master`.
3. DB: new tables are orphaned but harmless. Drop them later, at leisure. No
   migration touches existing tables, so there is no down-migration risk.

---

## 3. Cost optimisation — the core engineering work

### 3.1 The baseline problem

| Approach | Cost per 30-student, 45-min class |
|---|---|
| Naive: every student on a premium realtime API for the whole session | **~$150–$400** |
| Current LabMind (photo checkpoints only) | **~$1–$3** |

The goal is to keep the *feel* of the first row at close to the cost of the second.

### 3.2 Lever 1 — Escalation, not always-on (biggest single saving)

**The co-pilot does not run by default. It is triggered.**

The trigger logic reuses signals the app **already computes** — this is the key
insight, we don't need new intelligence to decide when to escalate:

| Trigger source | Existing file | Condition |
|---|---|---|
| Safety alert fired | `tools/safety.ts` | any `critical`/`high` severity conflict |
| Repeated vision failure | `steps[].vision_attempts` in `LabSession.steps` | `vision_attempts >= 2` on the same step |
| Risk band escalation | `tools/risk.ts` | `assessRisk().band === "high"` |
| Pacing implausibility | `tools/pacing.ts` | `verdict === "implausible"` |
| Student asks | new UI button | explicit "I need help" tap |
| Instructor pushes | instructor dashboard | instructor starts a live session with a struggling student |

Expected hit rate: **2–4 students out of 30**, for **2–4 minutes each**, not
30 × 45. That alone is a ~95% cost reduction versus always-on.

### 3.3 Lever 2 — Assemble the pipeline, don't buy the bundle

Premium realtime APIs (OpenAI Realtime, Gemini Live) bill audio-in + audio-out +
vision continuously and at a premium, including **billing silence**. Two paths:

- **Path A (premium, for the demo):** OpenAI Realtime / Gemini Live. Best
  latency and interruption handling. Use for the recorded demo video and the
  Grand Finale, where total minutes are trivially small.
- **Path B (budget, for real classroom use):** assemble it —
  `Whisper STT → gpt-4o-mini / Gemini Flash / Haiku (text reasoning) → cheap TTS`.
  Roughly an order of magnitude cheaper. Slightly worse turn-taking, which
  matters far less than the cost at 30-students scale.

**Design both behind one interface** (`realtime-provider.ts`, mirroring the
existing `llm/provider.ts` waterfall pattern the codebase already uses) so the
path is a config choice, not a rewrite. This is the same provider-agnostic
architecture that's already a selling point in the pitch — extend it, don't
fork it.

### 3.4 Lever 3 — Push-to-talk, not open-mic

Open-mic bills continuously and picks up lab background noise (fume hoods,
chatter, glassware) which also *degrades* transcription quality. Push-to-talk:

- Cuts audio-input minutes by ~70–80% in practice.
- Improves accuracy in a loud lab.
- Removes the privacy problem of a hot mic in a classroom (see §8).

Trade-off: slightly less "magical" than open-mic. Worth it on every axis except
demo sizzle — and for the *demo* we can run open-mic since it's 3 minutes.

### 3.5 Lever 4 — Two-stage frame gating (vision is the expensive part)

Never stream raw video to a model. Instead:

**Stage 0 — client-side, free, in-browser:**
- Sample at **0.5–1 fps**, never 30fps.
- Reuse the existing `tools/image-quality.ts` blur/exposure logic client-side
  to drop unusable frames before they leave the device.
- Perceptual-hash consecutive frames (`tools/image-fingerprint.ts` already
  implements dHash) — if the frame is ~identical to the last one sent, **don't
  send it**. A student staring at a burette produces near-identical frames for
  minutes; that's the single biggest waste.
- Downscale to the smallest resolution the check needs (the existing
  `image-crop.ts` already does region cropping — a burette meniscus check needs
  a strip, not a 4K frame). **Fewer pixels = directly fewer input tokens.**

**Stage 1 — cheap server-side model:** "has anything materially changed / is
this worth a real look?" → only on yes, escalate.

**Stage 2 — the strong vision model** (existing `vision-ensemble.ts` quality
bar) — only for actual verification moments.

Realistic effect: **10–50× fewer strong-model vision calls** than naive
streaming, with no loss in what's actually verified.

### 3.6 Lever 5 — Critical-window scoping

Even inside a triggered live session, don't narrate the whole experiment. Scope
to the risky window: the titration endpoint, a hazardous reagent addition, the
step that already failed twice. A **2–3 minute assist burst** delivers the
"someone is watching me" value; a 45-minute ride-along does not deliver 15× more.

Implement as: the co-pilot proposes its own exit ("you're back on track — I'll
step out, tap if you need me") rather than waiting to be dismissed. Agentic
self-termination is both a cost control **and** a better UX.

### 3.7 Lever 6 — Hard ceilings enforced in code

Not guidelines — enforced:

```ts
// session-manager.ts, checked on every tick
if (elapsedMinutes > COPILOT_MAX_MINUTES_PER_SESSION) → graceful close + handoff to photo flow
if (activeSessions >= COPILOT_MAX_CONCURRENT)         → queue or decline politely
if (dayMinutesForClass > COPILOT_MAX_MINUTES_PER_CLASS_DAY) → feature auto-disables for the day
```

Plus a **server-side watchdog**: any live session with no client heartbeat for
30s is force-closed. A browser tab closed mid-session must never leave a paid
stream open. This is the failure mode that actually generates surprise bills.

### 3.8 Lever 7 — Caching and reuse

- **Prompt caching** on the static parts of the system prompt (protocol text,
  safety rules, step definitions) — these are identical across every student in
  a class and are the bulk of input tokens. Supported by all three providers.
- **Per-class protocol cache**: parse the instructor's PDF **once** (already how
  `customProtocol` works today) and reuse for all 30 students. Already correct
  in the current design — do not regress it.
- **Response cache for common questions**: "what's the endpoint colour?" is
  asked by many students in the same session. Cache by (experiment, step,
  normalised question) with a short TTL.

### 3.9 Projected cost after all levers

| Scenario | Estimate |
|---|---|
| Grand Finale demo (1 student, 3 min, premium path) | **< $1** |
| Real class, 30 students, escalation-only, budget path | **~$3–$8** |
| Same class, always-on premium (what we're avoiding) | ~$150–$400 |

Order-of-magnitude figures for planning, not a quote — providers reprice, and
these must be re-measured against real usage before any pricing claim is made
publicly.

---

## 4. Agentic intelligence — "thinks by itself"

The current agent (`agent/orchestrator.ts`) is already a real tool-calling loop
with genuine chaining (`planFollowUp` picks a second tool from the first tool's
actual output). The co-pilot extends this from **reactive** (answers when asked)
to **proactive** (decides on its own that it should speak).

### 4.1 The autonomy loop

```
OBSERVE   → frame gate + transcript + live session state (step, risk, pacing, safety log)
ORIENT    → build a world-model: "student is on step 4, has failed vision twice,
             the flask is still colourless, 6 minutes over expected dwell time"
DECIDE    → should I speak at all? (the hard part — silence is usually correct)
ACT       → speak / call a tool / flag the instructor / stay quiet / exit
REFLECT   → did that help? did they comply? update memory
```

### 4.2 The "should I speak?" policy — the actual intelligence

An agent that comments constantly is worse than no agent. It must earn each
interruption. Speak only when:

- **Safety**: a hazard is visible or about to occur → always speak, immediately.
- **Irreversible error imminent**: about to overshoot the endpoint, about to add
  the wrong reagent → speak.
- **Stuck**: no meaningful state change for N minutes AND the student looks
  inactive → offer help once, then go quiet.
- **Asked**: direct question → answer.
- **Milestone**: step verified → brief confirmation, then silence.

Otherwise: **stay silent**. Encode this as an explicit, tunable policy object
(not buried in a prompt) so it can be tested, logged, and adjusted:

```ts
interface SpeakPolicy {
  minSecondsBetweenUnpromptedUtterances: number;   // e.g. 45
  maxUnpromptedPerStep: number;                     // e.g. 2
  alwaysSpeakOn: ("safety" | "irreversible")[];
  silenceIsDefault: true;
}
```

Every decision to speak *or stay silent* gets logged with its reason — this is
the training signal for §5 and the "explainability" story for the jury.

### 4.3 Tool access

Reuse the **existing** tool registry (`agent/tools.ts`) unchanged — the co-pilot
gets the same `check_safety`, `lookup_reagent`, `interpret_result`,
`notify_instructor`, `get_protocol_step` tools. Do not fork it.

Co-pilot-only additions (new file, registered only for the co-pilot):
- `request_camera_angle` — "point the camera at the burette"
- `pause_and_wait` — explicit "I'll wait while you do that", suppresses chatter
- `escalate_to_human` — pull the instructor in
- `end_session` — the agent decides it's done (cost control, §3.6)

### 4.4 Multi-agent structure (optional, phase 3)

Split into a cheap always-running **Watcher** (small model, frame gate, "is
anything happening?") and an expensive **Reasoner** (invoked only when the
Watcher raises a flag). This is the same escalation idea applied *inside* a live
session, and it's what keeps continuous monitoring affordable.

---

## 5. Self-learning — and being honest about what that means

"Self-learning" must not mean "the model retrains itself" — that's neither
feasible nor safe here. It means **the system measurably improves from its own
recorded outcomes**. LabMind already has the seed of this and it's genuinely
strong:

> `store/accuracy.ts` already treats every instructor approve/reject as a
> **labelled data point** about whether the vision system was right. That is a
> real closed feedback loop that already exists in the codebase.

### 5.1 Layer 1 — Memory (per student, per class) — safe, high value

- **Episodic**: what this student struggled with, which explanations landed,
  their pace. Next session: "last time the meniscus reading tripped you up —
  want me to watch for it?"
- **Semantic (per class/experiment)**: aggregate failure modes. "78% of this
  class overshoots the endpoint" → the co-pilot pre-empts it, and the
  *instructor* gets told, which is arguably the more valuable output.
- Storage: new `CopilotMemory` table (§6). No retraining. Fully inspectable and
  deletable — which matters for the DPDP/GDPR story already built.

### 5.2 Layer 2 — Outcome-driven prompt/policy tuning

Log every intervention with an outcome:
`(situation, what the agent said, did the student succeed after)`.
Then offline (a scheduled job, never in the hot path):
- Rank phrasings by measured success rate.
- Promote what works into the prompt library; retire what doesn't.
- Tune `SpeakPolicy` thresholds against real interruption/success data.

This is A/B testing with an autonomous promotion step — defensible as "self-
improving" without overclaiming.

### 5.3 Layer 3 — Threshold auto-calibration (extends existing work)

`risk.ts` already computes a per-student `verification_threshold`, and
`accuracy.ts` already measures agreement between AI and instructor per
confidence band, including `confidentMisses` (high-confidence rejections).
Close the loop: **feed measured agreement back into the thresholds
automatically**. If the high-confidence band shows systematic misses, raise the
bar; if instructors approve everything in the medium band, lower it.

This is real, safe, defensible self-calibration built on data the app **already
collects today**. Highest value-per-effort item in this section.

### 5.4 Layer 4 — Few-shot example harvesting

Instructor-approved verifications become few-shot examples for future vision
prompts on the *same* experiment/step. Improves accuracy per class without any
training run. Scope carefully (per-experiment, capped, reviewable).

### 5.5 Explicitly out of scope

- Fine-tuning / LoRA on student data → privacy, cost, and consent problems with
  minors' data. **No.**
- Any learning loop that can change **safety** rules autonomously. Safety rules
  stay human-authored and version-controlled, permanently. The agent may learn
  *how to explain* a safety rule; it may never learn *whether* one applies.

---

## 6. Data model additions (all new tables — no existing table is modified)

```prisma
model CopilotSession {
  id            String   @id @default(cuid())
  labSessionId  String            // soft reference, NO FK relation on LabSession
  studentName   String
  triggerReason String            // "safety" | "repeated_failure" | "student_request" | ...
  startedAt     DateTime @default(now())
  endedAt       DateTime?
  endedReason   String?           // "agent_exit" | "budget" | "watchdog" | "user"
  audioSeconds  Int      @default(0)
  framesSent    Int      @default(0)
  strongVisionCalls Int  @default(0)
  estCostCents  Int      @default(0)
  provider      String
  @@index([labSessionId])
}

model CopilotEvent {
  id               String   @id @default(cuid())
  copilotSessionId String
  kind             String   // "spoke" | "stayed_silent" | "tool_call" | "escalated"
  reason           String   @db.Text   // WHY — the explainability record
  content          String?  @db.Text
  at               DateTime @default(now())
  @@index([copilotSessionId])
}

model CopilotMemory {
  id           String   @id @default(cuid())
  scope        String   // "student" | "class" | "experiment"
  scopeKey     String
  key          String
  value        Json
  confidence   Float    @default(0.5)
  observations Int      @default(1)
  updatedAt    DateTime @updatedAt
  @@unique([scope, scopeKey, key])
}

model CopilotOutcome {
  id               String   @id @default(cuid())
  copilotSessionId String
  situation        String   @db.Text
  intervention     String   @db.Text
  succeededAfter   Boolean?
  at               DateTime @default(now())
}
```

**Deliberately no Prisma `@relation` to `LabSession`.** Soft references only, so
these tables can be dropped without touching the working schema — and so a
co-pilot bug can never cascade-delete real lab data. (Precedent: `AgentDecision`
already uses a plain `sessionId` string with no relation.)

---

## 7. Phased delivery

### Phase 0 — Spike (½ day, throwaway, NOT merged)
Prove the transport works: browser mic+camera → realtime provider → audio back.
Single hardcoded page, no DB, no auth, deleted afterwards. **Goal: kill the
unknown-unknowns before committing to a design.**

### Phase 1 — Triggered text co-pilot (no audio) — *lowest risk, ships first*
- Escalation triggers wired to existing `risk.ts` / `pacing.ts` / vision-failure
  signals.
- Agent proactively opens a **text** panel: "I noticed this step failed twice —
  want a hand?"
- Full `SpeakPolicy`, full event logging, hard budget ceilings.
- **No realtime API, no WebRTC, no new provider cost** — reuses the existing
  agent stack.
- This alone demos ~70% of the value ("the AI noticed and came to me") at ~0
  incremental cost and near-zero risk. **If time runs out, this is the version
  that ships.**

### Phase 2 — Voice
- Push-to-talk, budget pipeline (STT → text model → TTS).
- Fix `Permissions-Policy` for mic.
- Barge-in/interruption handling.

### Phase 3 — Live vision
- Frame gate (client hash + quality + downscale), two-stage escalation.
- Watcher/Reasoner split.

### Phase 4 — Learning loops
- Memory, outcome logging, threshold auto-calibration, few-shot harvesting.

### Phase 5 — Instructor-side
- Instructor sees which students the co-pilot is helping, can join the session,
  can read the co-pilot's reasoning log. Ties the feature back to the core
  product promise (one instructor, full oversight).

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Runaway cost** | Hard ceilings in code (§3.7), server watchdog, per-day cap, auto-disable. Cost counters written per session to `CopilotSession`. |
| **Breaks the working app** | Total file isolation (§2), separate route tree, flag defaults to off, single-commit revert. |
| **Privacy — hot mic + camera on minors in a classroom** | Push-to-talk (not open-mic), explicit per-session consent, no raw audio/video retention (transcripts only, or nothing), instructor-visible indicator that the co-pilot is active. Must be reflected in the existing Privacy Policy before any real classroom use. This is a **blocker for production**, not a nice-to-have. |
| **Latency makes it feel broken** | Budget path has worse turn-taking; measure before choosing. Fall back to text if round-trip > threshold. |
| **Lab Wi-Fi can't sustain video** | Frame gate already means we send ~1 small image/sec, not video. Degrade to text-only on poor connection (C4). |
| **Agent talks too much / annoys students** | `SpeakPolicy` with silence-as-default, capped unprompted utterances, logged and tunable. |
| **Agent gives wrong safety advice** | Safety answers must come from the existing `check_safety`/`lookup_reagent` tools, never from model free-recall. Same rule the current orchestrator already enforces in its system prompt. |
| **Demo fails live on stage** | Never demo the live path without a pre-recorded fallback video. Phase 1 (text) is far more robust for a live stage demo than Phase 2/3. |
| **Scope creep eats Finale prep** | Nothing in this plan is required for the Grand Finale. It is a roadmap slide unless Phase 1 lands comfortably early. |

---

## 9. Success metrics

- **Cost**: median cents per triggered session; total per class-day. Must stay
  under the §3.9 targets or the feature auto-disables.
- **Precision of escalation**: % of triggered sessions the student rated helpful.
  Low precision = we're interrupting people who were fine.
- **Intervention effectiveness**: success rate on the step *after* an
  intervention vs. a matched no-intervention baseline. This is the number that
  proves the feature works at all.
- **Silence ratio**: unprompted utterances per minute. Should be *low*.
- **Zero regressions**: existing test suite (110 tests) stays green throughout;
  no change in existing-flow error rates.

---

## 10. What to do first (when we resume)

1. **Do not start with WebRTC.** Start with Phase 1 (triggered text co-pilot) —
   it reuses the existing agent, costs nothing extra, and proves the escalation
   logic, which is the genuinely novel part.
2. Wire `escalation.ts` against `risk.ts` + `pacing.ts` + `steps[].vision_attempts`
   and just **log** what it *would* have triggered on real sessions, taking no
   action. Validates trigger precision with zero risk and zero cost.
3. Only then decide whether voice/vision is worth building, using that data.

**For the Grand Finale itself: this is a roadmap slide.** "Phase 2: Live AI
Co-Pilot — the agent joins the student when it detects they're struggling"
is a strong forward-looking story, and it costs zero risk to the working demo.
