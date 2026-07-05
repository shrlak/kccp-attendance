# KCCP Attendance — project memory

Korean church (한국중앙교회 피츠버그 대학·청년부) attendance system. The active app is a
**React + Vite + TS** SPA in `web/`; the legacy single-file `index.html` was removed at cutover
(recoverable from git history). **Production is live** at https://shrlak.github.io/kccp-attendance/.

## Stack & layout
- `web/` — React + Vite + TypeScript, Tailwind v4 (`@theme` in `web/src/index.css`), Zustand,
  TanStack Query, react-i18next (ko/en in `web/src/i18n/*.json`), React Router, Vitest + RTL.
  Fonts: Jua (display) + Gowun Dodum (body) — rounded/cute Korean.
- `supabase/functions/attendance-api/index.ts` — single Deno edge function (the API gateway,
  uses the **service-role key** → bypasses RLS). `auth.ts` has `verifyAdmin`/`scopeFilter`.
- `supabase/migrations/` — schema. Prod project ref: `loovulhchmmwagtvjnhc`.

## Auth / data model (post-cutover)
- **Admin auth = a shared team password (works from ANY device)**: `kccpadmin` →
  `super_admin` panel, `kccpleaders` → `leader` dashboard, `kccpwelcome` → `welcoming`
  dashboard (in `auth.ts` `SUPER_PASSWORD` / `LEADER_PASSWORD` / `WELCOMING_PASSWORD`, or env
  overrides; `passwordRole()` maps password→role). All are all-roster break-glass logins; a
  password typed on a personal device that's linked to a roled member keeps that member's
  scope instead. No email/Supabase Auth.
- `members` (UUID identity) ⟵ `devices.member_id` / `attendance_log.member_id`; roles in
  `member_roles` (super_admin / leader / pastor / welcoming). Leaders are scoped by group+동산
  (summer mode: KM leaders span 대학부+청년부 = 합동). Pastor is read-only.
- **RLS is deny-all** on all tables (no anon/authenticated policies); the edge function
  (service-role) is the only data path.
- 동산지기/부동산지기 are a **display-badge** system (`config.dongsan_leaders`), distinct from the
  `leader` admin role.

## Deploy / ops — IMPORTANT gotchas
- **Edge function deploys via CI**, not MCP: `mcp__Supabase__deploy_edge_function` and
  `get_edge_function` are **permission-denied** in this environment. `.github/workflows/deploy.yml`
  runs `supabase functions deploy` when the `SUPABASE_ACCESS_TOKEN` repo secret is set (it is).
  So **any `supabase/functions` change deploys on merge to `main`**. Current fn version: v14.
- **Pages deploy `needs` the edge-function job** (atomic cutover) → if the fn deploy fails, Pages
  is skipped and the site stays put. A `notify` job comments deploy-success on the PR.
- **Migrations: add a repo file in `supabase/migrations/` and merge** — since 2026-06-10 prod's
  `schema_migrations` was repaired to match the repo's date-prefix filenames 1:1, so the Supabase
  branching integration is functional again: merge to `main` auto-applies new migration files to
  prod, and PR preview branches replay the full set (keep files **idempotent + guarded**, and
  version prefixes **unique**, ordered after their dependencies — members table exists from
  `20260615`, email from `20260623`). If you must hot-apply via `mcp__Supabase__apply_migration`,
  it records an orphan full-timestamp version that re-breaks the `main` sync ("Remote migration
  versions not found") — afterwards DELETE that row from `supabase_migrations.schema_migrations`
  and add the repo file with the next free date prefix instead.
- **Vite `base: '/kccp-attendance/'`** (GitHub Project Pages subpath) + `BrowserRouter` basename +
  `dist/404.html` SPA fallback. Without the base, every asset 404s → blank page.
  **Vercel PR previews serve at the domain root, so they look broken — preview-only; Pages is prod.**
- Outbound network is allowlisted: `supabase.co` / `github.io` are blocked from this sandbox, so
  HTTP smoke tests of the live function/site fail with "Host not in allowlist". Verify via
  `mcp__Supabase__*` (DB/list_edge_functions) and the GitHub MCP instead.

## Git workflow
- Develop on the assigned `claude/...` branch. PRs created as **drafts**, **squash**-merged.
- The branch is deleted on each merge; recurring pattern to ship the next change cleanly:
  `git reset --hard origin/main` → re-apply/`cherry-pick` your commit → `git push --force`.
- Commit identity: `git config user.email noreply@anthropic.com && user.name Claude`. The
  squash-merge commits on `main` (committer `noreply@github.com`) are GitHub's, not yours — never
  rewrite them. Do not put the model id in commits/PRs/code.

## Status
Full Phase 1–4 parity + production cutover complete. Shipped: branded landing, KCCP logo
(light/dark), 동산 admin tab (summer-combined names), bulk 동산 assign/unassign, clear-all
attendance with super-approval, analytics layout, logout/reload→home. See `docs/superpowers/`
(gitignored; force-added curated docs) for the parity inventory, cutover plan, and runbook.
