# LabMind — AI Lab Partner

> Mobile-first agentic AI companion for physical science labs.
> **Team BitX · Capgemini Exceller Agentify Buildathon 2026**

LabMind watches, guides, and corrects students in real time during live experiments —
replacing the absent TA with a multimodal AI agent that reads instrument photos, cross-checks
experimental steps, detects reagent conflicts, and delivers experiment-specific result
interpretation. Four built-in experiments: acid-base titration, DNA gel electrophoresis, the
iodine clock reaction, and AUR (absorbance using a reference).

## A single Next.js app, deployed on Vercel, backed by Postgres

```
labmind/
├── src/
│   ├── app/                    # App Router: pages + API Route Handlers
│   │   ├── (public)/           # marketing home, login, signup
│   │   ├── (app)/student/…     # student join flow, dashboard
│   │   ├── (app)/lab/[sessionId]/   # step machine, photo capture, prelab quiz, results, integrity timeline
│   │   ├── (app)/instructor/…  # dashboard, create-session, bench wall, risk ranking, verification queue, reports
│   │   ├── (app)/settings/     # LLM provider + API key configuration
│   │   └── api/                # the "backend": one Hono catch-all route handler + NextAuth routes
│   ├── components/             # UI (student flow, instructor views, shell, ui primitives)
│   ├── hooks/ · lib/            # client session state, typed api-client, shared types
│   └── server/                  # server-only logic: tools, experiments, LLM layer, Prisma-backed store
├── prisma/                       # schema + migrations (Postgres via Supabase)
├── tests/                        # vitest — vision, safety, agent, interpreter, integrity, experiments
└── package.json
```

There is **no separate backend** — it's one deployable Next.js app. Auth is real (NextAuth,
credentials + Prisma adapter), and persistence is a genuine Postgres database (Supabase),
not an in-memory store — sessions, verification queues, agent-decision traces, and the
tamper-evident audit log all survive restarts and serverless cold starts.

## What makes the AI verification actually trustworthy, not just a demo

This is the part a technical judge will probe, so it's built to hold up:

1. **Blind reading, server-side judgment.** The vision model is never told the expected
   value — it reports only what it observes. The server alone decides pass/fail against the
   protocol's tolerance, so the model can't just agree with what it's told to expect.
2. **Two-pass zoom-and-crop.** A cheap first pass locates the instrument in the frame; the
   server crops and upscales to that region before the real read, so graduation marks that
   would otherwise be a few pixels get the model's full attention.
3. **Cross-provider ensemble.** When multiple provider keys are configured, the same photo is
   read by more than one model and reconciled — confidence comes from measured *agreement*
   across independent reads, not from a model's own (poorly calibrated) confidence claim.
4. **Physical-constraints layer — zero AI, deterministic.** A reading is checked against the
   instrument's real physical scale (in-range, on-graduation, monotonic with the student's own
   earlier readings, concordant with their own repeat runs). A model can hallucinate a
   plausible number; it can't make that number obey the glassware.
5. **Adaptive per-student verification threshold.** A risk engine scores each session from
   real signals (safety alerts, manual overrides, skipped/flagged steps, retries, pacing,
   caught duplicate photos, pre-lab quiz result) and raises or lowers that student's
   auto-verify confidence bar accordingly — a clean record gets less friction, a flagged one
   gets more instructor attention. This is wired into the actual routing decision, not just
   shown on a dashboard.
6. **Pacing / timing integrity.** Every step completion is timestamped; a titration that took
   40 seconds cannot have been performed as recorded, however good the photo looks — this
   catches a fraud mode (photographing someone else's setup) the vision pipeline structurally
   cannot.
7. **Cross-cohort duplicate-photo detection.** A perceptual hash catches the same photo
   resubmitted for a different step, or reused by a *different student in the same class*,
   not just within one student's own session.
8. **Tamper-evident audit log.** Safety events are written to an append-only hash chain (no
   update/delete path exists anywhere in the app for it) — each entry's hash is fixed at write
   time from its own content plus the previous entry's hash, so a later edit to the visible log
   is detectable, not just theoretically claimed.
9. **A real agent, not a scripted flow — even with zero API key configured.** The chat
   assistant plans, calls real tools (safety database, calculators, protocol lookup, result
   grading), and chains a second tool call from the first one's actual output (e.g. a
   high-severity safety conflict automatically escalates to the instructor console). This
   works identically in demo mode, which is the mode most likely running live for a judge.
10. **Real multi-tenant authorization, not just a login screen.** Instructor is not a
    self-service checkbox — becoming one requires the institution's passcode, checked
    server-side at signup. Every instructor route (class roster, CSV export, risk ranking,
    verification queue) is scoped to classes that instructor actually created, and every
    student route is scoped to that student's own session — one instructor account cannot
    browse another's cohort, and one student cannot read or tamper with another's grading
    data by guessing an ID.

## Demo mode (no API key needed)

`DEMO_MODE=true` (or no provider key configured) makes every AI tool return deterministic,
realistic — and *genuinely fallible* — data, so the app runs end-to-end with zero
configuration. Photo verification, pre-lab quizzes, and result interpretation are each
per-experiment (not just titration content reused everywhere), and the vision heuristic can
still catch a wrong-shaped photo and can still genuinely fail a numeric reading, so the
retake / needs-review / manual-override flows are demoable without wiring up a key. Set a
provider key in **Settings** to switch to a real model — `auto` uses OpenAI for chat and Gemini
for photo verification by default, pick one provider for everything ("OpenAI only" etc.), or pin
chat and vision to different providers independently (e.g. Claude for chat + OpenAI for vision) —
each capability's chosen model is itself picked from that provider's own live model list, so it
never gets stuck on an ID the provider has since deprecated.

## Getting started

Prerequisites: **Node 20+**, **pnpm**, and a Postgres database (Supabase or otherwise).

```bash
pnpm install
cp .env.example .env.local   # set DATABASE_URL / DIRECT_URL at minimum
npx prisma migrate deploy    # apply migrations
pnpm dev                     # http://localhost:3000
```

Production build:

```bash
pnpm build && pnpm start
```

Run tests:

```bash
pnpm test
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **New Project → import the repo**. Framework auto-detects as **Next.js**.
3. Add env vars: `DATABASE_URL`, `DIRECT_URL` (Postgres), `AUTH_URL`/`AUTH_SECRET` (NextAuth),
   and optionally `LLM_PROVIDER` + a provider key. Leaving the LLM vars unset runs in demo mode.
4. Deploy.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Marketing landing page |
| `/signup`, `/auth` | Account creation / sign in |
| `/student/join` | Student joins a session by code |
| `/lab/:sessionId` | Step-by-step guidance + live safety checks |
| `/lab/:sessionId/prelab` | Per-experiment pre-lab readiness quiz |
| `/lab/:sessionId/integrity` | Student-facing pacing + tamper-evident audit timeline |
| `/lab/:sessionId/report`, `/summary` | Generated lab report + learning summary |
| `/instructor/dashboard` | Live cohort overview |
| `/instructor/create-session` | Start a session (with optional PDF protocol upload) |
| `/instructor/wall` | Bench view — every student's live status |
| `/instructor/risk` | Adaptive risk ranking across the cohort |
| `/instructor/verify` | Manual verification queue |
| `/instructor/reports` | Per-student reports + accuracy dashboard |
| `/assistant` | Real-tool-calling chat agent |
| `/settings` | LLM provider + API key configuration |
| `/api/*` | Route Handlers (protocol, vision, safety, results, agent chat, instructor endpoints) |

## Environment

See [`.env.example`](.env.example). Key flags: `DATABASE_URL`/`DIRECT_URL` (Postgres),
`AUTH_URL`/`AUTH_SECRET` (NextAuth), `LLM_PROVIDER` (`demo`/`auto`/`openai`/`gemini`/`claude`),
`DEMO_MODE`. Provider keys can also be set per-instance from the **Settings** page.
