# LabMind — Setup on a New Machine

Everything needed to get LabMind running on a fresh machine (macOS, Linux or
Windows), and where to find each real value.

> **No real credentials are in this file, and none belong in this repository —
> it is public.** Every secret below is a placeholder with a pointer to where
> the live value actually lives. See §3 for how to move the real `.env` across
> safely.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS or newer | Next 15 needs ≥18.18; 20+ recommended |
| pnpm | 11.1.2 | pinned in `package.json` → use `corepack`, don't `npm i -g pnpm` |
| Git | any recent | |

```bash
corepack enable
corepack prepare pnpm@11.1.2 --activate
```

On macOS, Node via Homebrew (`brew install node`) or `nvm` both work.

---

## 2. Clone and install

```bash
git clone https://github.com/Harshit-Makraria/labmind.git
cd labmind
pnpm install
npx prisma generate
```

`prisma generate` is required before the first run — the Prisma client is
generated into `node_modules`, which is never committed.

---

## 3. Environment variables

`.env` is gitignored and **not** in this repo. Create it from the template:

```bash
cp .env.example .env
```

Then fill in the four required values. **Where each real value lives:**

| Variable | Required | Where to get the real value |
|---|---|---|
| `DATABASE_URL` | **yes** | Supabase → Project → Settings → Database → Connection string (**Transaction / pooled**, port 6543, keep `?pgbouncer=true`) |
| `DIRECT_URL` | **yes** | Same page → **Session / direct** connection (port 5432). Migrations must bypass the pooler. |
| `AUTH_SECRET` | **yes** | Vercel → Project → Settings → Environment Variables. **Do not regenerate it** — see the warning below. |
| `AUTH_URL` | **yes** | `http://localhost:3000` locally; the deployed origin in production |
| `LLM_PROVIDER` | no | `auto` (default) or `demo` |
| `OPENAI_API_KEY` | no | platform.openai.com → API keys |
| `GEMINI_API_KEY` | no | aistudio.google.com → API keys |
| `ANTHROPIC_API_KEY` | no | console.anthropic.com → API keys |

> **Do not regenerate `AUTH_SECRET`.** It signs session cookies. A new value
> silently invalidates every existing login, on every device, in production.
> Copy the existing one across.

### Moving the real `.env` between your own machines

Pick any of these — all keep the secrets out of the repo and out of email:

1. **Vercel is the source of truth.** The production values are already there:
   Project → Settings → Environment Variables → reveal and copy. With the
   Vercel CLI: `vercel env pull .env` writes them straight into a local `.env`.
2. **Supabase dashboard** for the two database URLs, as above.
3. **A password manager** (1Password, Bitwarden) — paste `.env` in as a secure
   note and retrieve it on the other machine.
4. **AirDrop / direct transfer** of the `.env` file itself between your own
   devices.

**Do not** commit `.env`, paste it into a public repo or issue, or send it over
plain email — anything that lands in a public place or an inbox is effectively
permanent and, for a public repo, world-readable within seconds.

---

## 4. Run it

```bash
pnpm dev            # http://localhost:3000
pnpm test           # vitest — should be all green
pnpm typecheck      # tsc --noEmit
pnpm build          # production build
```

Claude Code picks up `.claude/launch.json` automatically, so the preview/dev
server integration works with no extra setup.

---

## 5. Platform notes

### macOS / Linux
- `sharp` is a native binary. `.npmrc` pins
  `supportedArchitectures[cpu]=x64,current` and `optionalDependencies` carries
  `@img/sharp-linux-x64` for Vercel's Linux runtime. On Apple Silicon the
  `current` entry should resolve `darwin-arm64` correctly. If image processing
  throws on first run:
  ```bash
  pnpm rebuild sharp
  ```
- You can run `pnpm build` while `pnpm dev` is running.

### Windows
- **Stop the dev server before `pnpm build` or `npx prisma generate`.** Building
  while `next dev` is running corrupts `.next` (blank pages, 404s on core
  chunks), and `prisma generate` fails on a locked
  `query_engine-windows.dll.node`. Restart the dev server afterwards.

---

## 6. Database

Local development and production currently share **the same Supabase database**.

**Consequences, which matter more than they look:**

- Any account, session or instructor code created while testing locally is a
  **real production row**. Clean it up when you're done.
- Migrations run against production. Apply them with:
  ```bash
  npx prisma migrate deploy
  ```
  Migrations are hand-written under `prisma/migrations/<timestamp>_<name>/`;
  `migrate dev` is interactive and not used here.

Splitting local and production databases is worth doing before this is used by
real students.

---

## 7. Deployment

**Deploy by pushing to GitHub — never with the Vercel CLI directly.**

```bash
git push origin master:main
```

Vercel builds from `main` automatically. The local branch is `master`; the
deploy branch is `main`, hence the explicit refspec.

---

## 8. Demo mode

With no provider key set, the app runs in demo mode: AI checks return
deterministic — and genuinely fallible — results, and PDF parsing falls back to
the library experiment with an honest on-screen reason.

This is deliberate: the whole product is demonstrable with zero configuration.
But it also means **AI reading quality is unverified** until a real key is
present. The pipeline is tested; the model's real-world accuracy on a given
photo is not.

Keys can also be set at runtime from the in-app **Settings** page (stored
server-side), which overrides the env defaults.

---

## 9. Further reading

| Document | What it covers |
|---|---|
| [`SESSION_LOG.md`](SESSION_LOG.md) | What was built and why, with verification notes |
| [`UNIVERSAL_LABS_PLAN.md`](UNIVERSAL_LABS_PLAN.md) | Roadmap for supporting every subject |
| [`LIVE_COPILOT_PLAN.md`](LIVE_COPILOT_PLAN.md) | Live AI co-pilot design and cost model |
| [`../README.md`](../README.md) | Product overview |
