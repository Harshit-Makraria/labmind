# LabMind — Build Plan

> AI Lab Partner · Team BitX · Capgemini Exceller Agentify Buildathon 2026
> Source spec: `LabMind_Prototype_Spec.docx`.

---

## ✅ CURRENT STATE (supersedes the roadmap below — last verified 2026-07-29)

**The project is a single root-level Next.js app**, deployed on Vercel, backed by a real
Postgres database. The original Python/FastAPI + monorepo plan further down this file, and the
brief "in-memory store" phase that followed it, are both historical context only.

- **One deployable unit.** The whole backend is **Next.js Route Handlers**
  (`src/app/api/[[...route]]/route.ts`, a Hono catch-all). No separate server, no Python.
- **Real persistence, not a demo store.** Prisma + Postgres (Supabase). Sessions, verification
  queues, agent-decision traces, and the tamper-evident audit log all survive restarts and
  serverless cold starts — see `prisma/schema.prisma`.
- **Real auth.** NextAuth v5 (credentials + Prisma adapter) — signup/login, not just an
  instructor passcode (the passcode still exists as a legacy fallback).
- **4 experiments, not 1**: acid-base titration (flagship), DNA gel electrophoresis, iodine
  clock reaction, and AUR (absorbance using a reference) — each with its own vision-check type,
  reagent safety data, result-interpretation copy, and demo pre-lab quiz.
- **The AI verification pipeline is layered, not a single model call**: blind reading (model
  never told the expected value) → two-pass zoom-and-crop → cross-provider ensemble (when
  multiple keys are configured) → a zero-AI physical-constraints check (range, graduation,
  monotonicity, replicate concordance) → an adaptive per-student verification threshold from a
  risk engine (safety alerts, overrides, skips, retries, pacing, caught duplicate photos,
  pre-lab result). All of this is *wired into the actual routing decision*, not display-only.
- **Academic-integrity system**: pacing/timing analysis (a titration can't be done in 40s,
  however good the photo looks), cross-cohort duplicate-photo detection (perceptual hash, not
  scoped to just one student), and an append-only tamper-evident audit log (hash fixed at write
  time, so a later edit is actually detectable — not just claimed).
- **A real agent, even key-free.** The chat assistant (`/assistant`) plans, calls real tools,
  and chains a second tool call from the first one's actual output (e.g. a high-severity safety
  conflict auto-escalates to the instructor console) — in demo mode too, not only with a live
  LLM key.
- **LLM layer stays provider-agnostic** (`demo`/`auto`/`openai`/`gemini`/`claude`) in
  `src/server/llm`; `auto` waterfalls Claude → OpenAI → Gemini across whichever keys are
  configured and falls back to demo. Demo mode is deterministic but **genuinely fallible** —
  it can reject a wrong-shaped photo and can genuinely fail a numeric reading, so the
  retake/needs-review/manual-override flows are demoable with zero API key.
- **Build and tests are green** (`pnpm build` exits 0; `pnpm test` — vitest — covers vision,
  safety, the agent loop, result interpretation, the physical-constraints layer, the audit
  chain, and per-experiment quiz content).

Run: `pnpm install`, set `DATABASE_URL`/`DIRECT_URL`/`AUTH_SECRET`/`AUTH_URL` in `.env.local`,
`npx prisma migrate deploy`, then `pnpm dev` → http://localhost:3000. Deploy: push to GitHub →
import in Vercel. See [README.md](README.md) for the full route list and environment reference.

The current source tree lives at the repo root under `src/` — **not** under `apps/`.

---

## 1. What we're building

A jury-ready prototype demonstrating **5 features**:

| # | Feature | Endpoint | Demo-mode behaviour |
|---|---------|----------|---------------------|
| 1 | Protocol ingestion + step-by-step guidance | `POST /api/protocol/parse` | Returns hardcoded 8-step titration protocol |
| 2 | Computer-vision photo verification | `POST /api/vision/check` | Returns `{reading:24.6, confidence:0.91, pass:true}` |
| 3 | Safety alert engine (reagent conflicts) | `POST /api/safety/check` | Looks up `reagent_safety.json` (20+ pairs) |
| 4 | Result interpretation (deviation diagnosis) | `POST /api/results/interpret` | Returns 6% deviation → parallax-error diagnosis |
| 5 | Real-time instructor dashboard | `GET /dashboard` + `WS /ws/dashboard` | Live session grid, mock data if no sessions |

**Non-negotiables for the jury:** agentic behaviour (Semantic Kernel orchestrator picks tools, retries, cross-step reasoning), official stack visible (Azure OpenAI + Semantic Kernel + LangChain), safety-first UX (full-screen modal), mobile-first PWA, OpenTelemetry traces, works fully in `DEMO_MODE` with no API key.

---

## 2. Architecture decisions (locked in with the user)

| Decision | Choice | Why |
|----------|--------|-----|
| Repo layout | **Monorepo** — pnpm workspaces + Turborepo | User wants Next.js monorepo (spec had flat backend/+frontend/) |
| Frontend | **Next.js 16** (App Router, React 19, Tailwind v4, TanStack Query) | Mirrors `nexica_crm` conventions |
| Backend / agent | **Python FastAPI** with Semantic Kernel + LangChain | Keeps the buildathon "official stack" genuinely in code |
| LLM provider | **Provider-agnostic** interface, default **GPT-4o** | Jury expects GPT-4o; Claude pluggable |
| Persistence | **In-memory `SessionStore` interface** (swappable) | Spec says in-memory is fine; interface = production-quality signal |
| Real-time | **WebSocket served by FastAPI** | Next.js serverless can't hold persistent WS |
| DEMO_MODE | **Env flag, fully mocked responses** | Must demo with no API key |

---

## 3. Monorepo structure

```
labmind/
├── apps/
│   ├── web/                      # Next.js 16 PWA (student + instructor dashboard)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx · page.tsx          # Home / Upload
│   │   │   │   ├── lab/[sessionId]/page.tsx       # Step card flow
│   │   │   │   ├── lab/[sessionId]/photo/page.tsx # Photo capture
│   │   │   │   ├── lab/[sessionId]/result/page.tsx# Result entry + card
│   │   │   │   ├── dashboard/page.tsx             # Instructor (passcode-gated)
│   │   │   │   └── api/[[...route]]/route.ts      # Hono BFF (demo data, proxy)
│   │   │   ├── components/
│   │   │   │   ├── ui/                            # shadcn/radix primitives
│   │   │   │   ├── student/                       # UploadScreen, StepCard, PhotoCapture,
│   │   │   │   │                                  #   SafetyModal, ResultCard, ProgressBar
│   │   │   │   └── dashboard/                     # StudentCard, SummaryBar, TraceLogPanel
│   │   │   ├── features/                          # protocol, vision, safety, results, dashboard
│   │   │   ├── hooks/                             # useSession, useDashboardWS
│   │   │   ├── lib/                               # api-client, demo-data, utils, query-client
│   │   │   └── types/                             # re-exports @labmind/shared-types
│   │   ├── public/manifest.json + icons          # PWA
│   │   ├── next.config.ts · tsconfig.json · package.json
│   │
│   └── api/                      # Python FastAPI backend
│       ├── app/
│       │   ├── main.py                # FastAPI app, CORS, telemetry, router mount
│       │   ├── config.py              # Settings from .env (DEMO_MODE, keys, passcode)
│       │   ├── routers/               # protocol · vision · safety · results · dashboard
│       │   ├── agents/                # orchestrator.py (Semantic Kernel) · session_manager.py
│       │   ├── tools/                 # protocol_parser · vision_tool · safety_tool · result_interpreter (LangChain)
│       │   ├── llm/                   # provider.py interface + openai_provider · claude_provider · demo_provider
│       │   ├── schemas/               # pydantic models = API contracts
│       │   ├── store/                 # session_store.py interface + memory_store.py
│       │   ├── data/                  # reagent_safety.json · sample_lab.py (titration text)
│       │   └── observability/         # tracing.py (OpenTelemetry)
│       ├── tests/                     # golden_dataset.json · test_all.py (pytest)
│       ├── requirements.txt · pyproject.toml
│
├── packages/
│   └── shared-types/             # TS API-contract types mirroring pydantic schemas
│
├── pnpm-workspace.yaml · turbo.json · package.json (root)
├── .env.example · docker-compose.yml · README.md · PLAN.md
```

---

## 4. API contracts (shared-types ⇄ pydantic)

- **ProtocolStep**: `step_number, title, instructions[], reagents[], duration_seconds, safety_flags[], science_explanation, expected_observation, vision_check_required, vision_expected`
- **VisionResult**: `reading, confidence, pass, deviation, message, notes`
- **SafetyResult**: `conflict, severity, type, description, action`
- **InterpretResult**: `deviation_percent, severity, diagnosis, improvement, learning_point`
- **DashboardEvent** (WS): `step_complete | safety_alert | result_submitted`

These live once in `packages/shared-types` (TS) and `apps/api/app/schemas` (pydantic) and must stay in sync.

---

## 5. Phased build order

- **Phase 0 — Scaffold** (this pass): monorepo tooling, both apps, shared-types, all stub files, configs, `.env.example`, README. App boots empty.
- **Phase 1 — Feature 1 vertical slice** (this pass): protocol parse endpoint (demo + provider-agnostic), session store, Upload → Loading → Step Card flow with progress bar, reagent chips, timer, safety-flag banner, "Mark Complete & Capture" button. Validates the whole web⇄api⇄LLM path.
- **Phase 2 — Feature 3 Safety**: `reagent_safety.json` + safety tool + full-screen SafetyModal (runs on each step advance).
- **Phase 3 — Feature 2 Vision**: photo capture UI + vision tool (GPT-4o Vision / demo), confidence gating, re-photograph + manual override.
- **Phase 4 — Feature 4 Results**: result entry + interpreter + colour-coded ResultCard.
- **Phase 5 — Feature 5 Dashboard + agentic glue**: Semantic Kernel orchestrator, WebSocket broadcast, instructor dashboard grid + trace-log panel.
- **Phase 6 — Polish**: OpenTelemetry traces, PWA/offline, mobile testing, golden-dataset tests, README + demo script.

---

## 6. Design system (from spec §5.2)

- Colors: Primary `#1A3A5C` navy · Secondary `#2B6CB0` · Accent `#38A169` green · Warning `#D69E2E` amber · Danger `#E53E3E` · BG `#F7FAFC` · Card `#FFFFFF`.
- Type: Inter. Heading 24–32px bold, body 14–16px, step number 64px bold.
- Mobile-first 375px base, max-width 640px centered. Cards `rounded-2xl shadow-md`. Buttons full-width, `rounded-xl`, min-height 52px. Safety modal `fixed inset-0 z-50 bg-red-700`.

---

## 7. Run commands (target)

```bash
pnpm install                 # root — installs web + shared-types
pnpm dev                     # turbo: runs web (3000) + api (8000)
# api only:  cd apps/api && uvicorn app.main:app --reload --port 8000
# web only:  pnpm --filter web dev
pnpm test                    # api pytest golden dataset
```
