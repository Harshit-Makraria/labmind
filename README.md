# LabMind — AI Lab Partner

> Mobile-first agentic AI companion for physical science labs.
> **Team BitX · Capgemini Exceller Agentify Buildathon 2026**

LabMind watches, guides, and corrects students in real time during live experiments —
replacing the absent TA with a multimodal AI agent that reads burette levels from photos,
cross-checks experimental steps, detects reagent conflicts, and delivers experiment-specific
result interpretation. Demo experiment: acid-base titration.

## A single Next.js app (deploys to Vercel like any Next.js project)

```
labmind/
├── src/
│   ├── app/                    # App Router: pages + API Route Handlers
│   │   ├── page.tsx            # student home (upload / sample)
│   │   ├── lab/[sessionId]/    # step machine, /photo, /result
│   │   ├── dashboard/          # instructor dashboard
│   │   └── api/                # the "backend": protocol, vision, safety, results, dashboard
│   ├── components/             # UI (student flow, ui primitives)
│   ├── hooks/ · lib/           # client session, typed api-client, shared types
│   └── server/                 # server-only logic: tools, in-memory store, LLM layer, data
├── PLAN.md
└── package.json
```

There is **no separate backend**. The Python/FastAPI service was ported to **Next.js Route
Handlers** (`src/app/api/*`) so the whole thing is one deployable unit. The LLM layer stays
**provider-agnostic** (`demo` / OpenAI / Azure / Claude); sessions live in an in-memory store
behind a small interface (swappable for Redis/Postgres). See [PLAN.md](PLAN.md).

## Five features (all implemented)

1. **Protocol ingestion** — start a lab → ordered step state machine with reagents, timers, "why it matters"
2. **Vision verification** — capture a photo → AI reads the burette/colour against the expected value
3. **Safety engine** — reagent-conflict + concentration detection with a full-screen alert (22-pair knowledge base)
4. **Result interpretation** — % deviation → green/amber/red diagnosis, fix, and learning point
5. **Instructor dashboard** — passcode-gated live cohort, per-student status, and an agent-activity (trace) panel

## Demo mode (no API key needed)

`DEMO_MODE=true` (the default) makes every AI tool return deterministic, realistic data, so the
app runs end-to-end with **zero configuration** — ideal for the jury and for Vercel. A **DEMO MODE**
badge shows in the corner. Set `DEMO_MODE=false` + a provider key to use a real model.

## Getting started

Prerequisites: **Node 20+** and **pnpm**.

```bash
pnpm install
cp .env.example .env.local   # optional — defaults work in demo mode
pnpm dev                     # http://localhost:3000
```

Production build:

```bash
pnpm build && pnpm start
```

## Deploy to Vercel

It's a standard Next.js app — no special config:

1. Push this repo to GitHub.
2. In Vercel: **New Project → import the repo**. Framework auto-detects as **Next.js**, build
   command `pnpm build`, output handled automatically.
3. (Optional) Add env vars `LLM_PROVIDER`, `DEMO_MODE`, `INSTRUCTOR_PASSCODE`, and any provider
   keys. Leaving them unset runs in demo mode.
4. Deploy. That's it.

> Note: sessions use an in-memory store, which is per-instance on serverless. For the demo this
> is intentional (deterministic, no DB). Swap `src/server/store` for Vercel KV/Redis to make
> live state durable across instances.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Student home — start lab / use sample |
| `/lab/:sessionId` | Step-by-step guidance + live safety checks |
| `/lab/:sessionId/photo` | Photo capture + AI vision check |
| `/lab/:sessionId/result` | Result entry + interpretation |
| `/dashboard` | Instructor dashboard (passcode: `labmind2026`) |
| `/api/*` | Route Handlers (protocol, vision, safety, results, dashboard) |

## Environment

See [`.env.example`](.env.example). Key flags: `LLM_PROVIDER` (`demo`/`openai`/`azure`/`claude`),
`DEMO_MODE`, `INSTRUCTOR_PASSCODE` (default `labmind2026`).
