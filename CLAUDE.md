# LabMind — Project Conventions

Conventions for working in this repository. Setup lives in
[`docs/SETUP.md`](docs/SETUP.md).

## Stack

Next.js 15 (App Router) · Hono catch-all API at `src/app/api/[[...route]]/route.ts` ·
NextAuth v5 (JWT) · Prisma 5 + Supabase Postgres · Tailwind 4 · Vitest · pnpm.

There is **no separate backend**. The API ships inside the Next app as Route
Handlers, so it is same-origin in production.

## Hard rules

1. **Deploy only by pushing to GitHub.** `git push origin master:main`. Never
   run `vercel --prod` directly. Local branch is `master`, deploy branch is
   `main`.

2. **Local dev writes to the production database.** Any account, lab session or
   instructor code created while testing is a real production row. Delete it
   afterwards and confirm the deletion.

3. **Never commit secrets.** This repository is public. `.env` is gitignored and
   must stay that way. Use placeholders in docs and point at Vercel/Supabase for
   real values.

4. **On Windows, stop the dev server before `pnpm build` or `prisma generate`.**
   Building while `next dev` runs corrupts `.next`; `prisma generate` fails on a
   locked `query_engine-windows.dll.node`. Not an issue on macOS/Linux.

5. **Verify with real calls.** Several bugs in this codebase were only visible in
   a live API response or browser session — not in the types, and not in tests.
   Prefer an actual request over an assumption.

## Before pushing

```bash
pnpm typecheck && pnpm test && pnpm build
```

All three must pass. The suite is the regression gate for the invariants below.

## Invariants that must not regress

These each encode a real bug that was found and fixed. Breaking one silently
reintroduces it.

- **Instructor data isolation.** Every instructor-facing query is scoped to
  `{OR: [{createdByUserId: ownerUserId}, {code: DEMO_INSTRUCTOR_CODE}]}`.
  `LAB-0042` is the one deliberately shared demo class; every other ownerless
  row is owner-only. `AgentDecision` has no Prisma relation to `LabSession`, so
  scoping it needs a two-step lookup, not a nested `where`.

- **Blind reading.** The vision model is **never** told the expected value —
  including on descriptive checks. Models anchor hard on a number handed to
  them; this is why a 6 mL burette was once "read" as 24.5 mL. The model reports
  observations; the **server** judges. There is a test asserting the target
  never appears in the prompt.

- **Custom experiments are graded against their own expected result.**
  `Protocol.expected_result` wins over the library experiment's `theoretical`.
  Grading a custom experiment against the library value produced ~80% deviation
  for a correct answer.

- **Custom experiments get subject-neutral coaching.** The library experiments'
  domain copy is chemistry-specific; routing a physics experiment through it
  produced "your titration technique was sound" for a resistance measurement. A
  test fails if chemistry vocabulary leaks into custom feedback.

- **Non-numeric results store `null` deviation, never `0`.** A fabricated 0%
  makes an ungraded session look perfect and poisons class averages.

- **Qualitative answers are never auto-graded.** A keyword match would be a
  confident wrong verdict. They go to the instructor.

- **Every submitted photo is kept, whatever the outcome.** Auto-verified,
  failed, retake and duplicate captures are all persisted — only
  `needs_review` is stored as `pending`, because only that is an instructor
  *task*. Previously just the queued ones were saved and everything else was
  analysed then discarded.

- **Photos read from both storage locations.** `imageKey` (object storage) wins;
  `imageBase64` (inline) is the fallback and covers every older row. Never
  assume one or the other — that dual read is what makes the migration
  backfill-free.

- **Erasure must reach the bucket.** Deleting a user's rows is not enough once
  photos live in object storage; collect `photoKeysForSessions()` and call
  `deletePhotos()` *before* deleting the rows, or the images survive and the
  Privacy Policy's erasure promise becomes false.

- **Authenticated media must not be cached.** The photo endpoint sends
  `no-store`. It once sent `immutable` with a one-year lifetime, and on a
  shared lab machine the browser replayed a cached hit for the *next* login
  without re-running the ownership check.

- **Safety rules stay human-authored.** The AI may explain a safety rule; it may
  never invent, infer or retire one.

## Conventions

- **Comments explain *why*, not *what*.** Most comments here record the bug or
  constraint that motivated the code. Preserve that when editing nearby.
- **Match the surrounding style** — naming, comment density, idiom.
- **Additive over invasive.** New capability goes in new files where it can;
  see `docs/LIVE_COPILOT_PLAN.md` §2 for the isolation pattern.
- **Fail honestly.** When something can't be done — no API key, an unreadable
  PDF, an ambiguous photo — say so specifically. Never approve to be helpful.

## Migrations

Hand-write `prisma/migrations/<timestamp>_<name>/migration.sql`, then:

```bash
npx prisma migrate deploy
npx prisma generate
```

`migrate dev` is interactive and isn't used here. Migrations run against
production — see rule 2.
