# Cloudflare parallel stack (Workers + D1 + Pages)

A parallel, non-production deployment of the KCCP attendance system on Cloudflare's free
plan: **Workers** replace the Supabase Deno edge function, **D1** (SQLite) replaces
Postgres, and **Cloudflare Pages** can serve the same React app the GitHub Pages build
does. Production stays on Supabase + GitHub Pages (`.github/workflows/deploy.yml`,
untouched) until this stack is verified and a deliberate cutover decision is made —
nothing here touches prod, and no production data has been migrated yet.

The one intentional remaining Supabase dependency: **Google sign-in** still goes through
Supabase Auth (GoTrue) — the Worker verifies the resulting JWT with a single `fetch` to
Supabase's Auth REST endpoint (no SDK). Everything else — every table, every business
rule — lives in D1 and the Worker.

## What's here

- `worker/` — the Cloudflare Worker (Hono router), D1 schema/migrations, and tests.
- `deploy-cloudflare.yml` (in `.github/workflows/`) — CI that deploys the Worker + applies
  D1 migrations + builds/deploys Cloudflare Pages, gated on secrets so it's a no-op until
  configured.

## Local development (no Cloudflare account needed)

Everything below runs against Miniflare's local Workers/D1 emulation — no network access
to Cloudflare's API and no account required.

```bash
cd cloudflare/worker
npm install
npm run db:migrate:local   # applies migrations/*.sql to a local D1 file
npm run dev                # wrangler dev on http://localhost:8787
npm test                   # vitest, runs inside the Workers runtime via Miniflare
```

To exercise the real frontend against this local Worker:

```bash
cd web
VITE_API_BASE=http://localhost:8787 npm run dev
```

(Note: `VITE_API_BASE` has no trailing `/api` — `web/src/lib/api.ts` appends its own
`/api/...` paths.)

## What was ported vs. dropped

Only the ~36 routes the current React app actually calls were ported (see the route
files under `worker/src/routes/`). Roughly half of the original edge function's routes
were pre-cutover legacy endpoints (name/device-based auth, `config.admin_devices`) that a
`web/src` grep confirmed are dead code — they were not ported. `events`/`event_attendees`
(0 rows in prod, only referenced by dropped legacy routes) were also dropped. The Supabase
Realtime kiosk multi-tab broadcast has no free-plan equivalent (Durable Objects require a
paid Workers plan) — the app's existing polling fallback covers it instead.

## Postgres → SQLite (D1) translation rules

Applied uniformly in `worker/migrations/0001_init.sql`:

- `uuid` / `gen_random_uuid()` → `TEXT`, populated by `crypto.randomUUID()` in Worker code.
- `jsonb` columns → `TEXT`, `JSON.stringify`/`JSON.parse` at the Worker boundary
  (`src/lib/db.ts`'s `toJson`/`fromJson`).
- `timestamptz`/`date` → `TEXT` (ISO datetime / `YYYY-MM-DD`), set explicitly by the Worker.
- `bigserial`/`serial` → `INTEGER PRIMARY KEY` (SQLite rowid aliasing autoincrements).
- `boolean` → `INTEGER` (0/1).
- Foreign keys with `ON DELETE CASCADE`/`SET NULL` port verbatim; `PRAGMA foreign_keys=ON`
  is set in the migration — verified by the member-delete/merge tests since those routes
  depend on cascade behavior.
- Deny-all RLS isn't needed at all: D1 has no anon/direct-DB access path, only `env.DB`
  from the Worker, so the same security posture falls out of the architecture for free.

## One-time Cloudflare account setup (Phase 2 — needs your account, not this sandbox)

This sandbox has no Cloudflare credentials or network access to `api.cloudflare.com`, so
these steps need to run on your machine (or a session with those credentials):

1. **Create a free Cloudflare account** at cloudflare.com if you don't have one.
2. **Authenticate wrangler**: `cd cloudflare/worker && npx wrangler login`.
3. **Create the D1 database**: `npx wrangler d1 create kccp-attendance` — copy the printed
   `database_id` into `wrangler.toml`'s `[[d1_databases]]` block (replacing the
   `00000000-…` placeholder).
4. **Set secrets** (each falls back to the same default as the Supabase function if
   unset, so this step is optional for a first smoke test, but should be done before
   real use):
   ```bash
   npx wrangler secret put SUPER_PASSWORD
   npx wrangler secret put LEADER_PASSWORD
   npx wrangler secret put WELCOMING_PASSWORD
   npx wrangler secret put GEMINI_API_KEY
   ```
5. **First deploy** (or let CI do it once the repo secrets below are set):
   ```bash
   npx wrangler d1 migrations apply kccp-attendance --remote
   npx wrangler deploy
   ```
6. **Create the Pages project**: `npx wrangler pages project create kccp-attendance`,
   then build and deploy once:
   ```bash
   cd ../../web && CF_PAGES=1 VITE_API_BASE=<your-worker-url> npm run build
   cd ../cloudflare/worker && npx wrangler pages deploy ../../web/dist --project-name=kccp-attendance
   ```
7. **Wire up CI**: add repo secrets `CLOUDFLARE_API_TOKEN` (an API token scoped to
   Workers/D1/Pages edit) and `CLOUDFLARE_ACCOUNT_ID`, plus a repo **variable**
   `CLOUDFLARE_WORKER_URL` set to the Worker's `*.workers.dev` URL from step 5 — then
   every push to `main` deploys both automatically via `deploy-cloudflare.yml`.
8. **Google sign-in on the new Pages URL**: add the `*.pages.dev` origin to Supabase
   Auth's allowed redirect URLs list (Supabase dashboard → Authentication → URL
   Configuration) — `web/src/stores/useAdminAuth.ts` already derives the redirect from
   `window.location.origin`, so no code change is needed once that's added.

## Explicitly out of scope here

- **Custom domain** — deferred; use the free `*.workers.dev` / `*.pages.dev` subdomains
  for now.
- **Production data migration/cutover** — this stack starts empty (migrations only create
  schema, no data). Migrating real Supabase data into D1, and any decision to point
  production traffic here, is a separate, later step.
