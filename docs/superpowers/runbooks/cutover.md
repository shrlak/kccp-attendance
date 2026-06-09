# Production Cutover Runbook — Auth + Member IDs + RLS

> Phase F of `docs/superpowers/plans/2026-06-08-auth-rls-cutover-plan.md`.
> Project: `loovulhchmmwagtvjnhc` (kccp-attendance, prod). Model: device-id + master password.
> Window: non-Sunday, off-hours (check-in only matters Sun 13:00–15:00 ET).

## Pre-flight state (verified 2026-06-09)

- **Migrations applied:** through `lee_kyungheon_new_member` only — the hardening migrations
  (`member_identity`, `admin_roles`, `member_backfill`, `rls`) are **not** applied.
  (Prod migration versions are full timestamps that don't match repo date-prefix filenames,
  so we apply the remaining migrations individually via the MCP, not `supabase db push`.)
- **Edge function:** `attendance-api` version 11 (legacy — `/api/data` world-readable). Uses
  the **service-role key**, so it bypasses RLS. v11 is retained in Supabase function **version
  history** (dashboard) for rollback — `get_edge_function` is denied via MCP, so the source was
  not snapshotted locally.
- **Frontend:** legacy `index.html` via GitHub Pages (`deploy.yml`).
- **Data:** 49 devices (47 ROSTER, 1 personal `DEV-B5D13150-CCFD0D1F` = 김호연, 1 `NEW-…`),
  `attendance_log` **empty**, `config.summer_mode = true`, `individual_checkin_enabled = false`
  (kiosk-first), `require_approval = false`. Data snapshot captured to
  `rollback/data-snapshot-pre-cutover.json` (local only — contains device PII, intentionally
  not committed; `docs/` is gitignored).
- **Super-admin continuity:** `config.admin_devices` has super = `DEV-B5D13150` (김호연, a
  *personal* device) → after backfill his member gets `super_admin` in `member_roles` and can
  sign into the new admin immediately with the master password. (박주연/`ROSTER-44` also becomes
  super but must register a personal device to use it.)
- **Collision report:** resolved — the two 김서현 are already distinct names in the seed
  (`ROSTER-05` = 김서현(대학부), `ROSTER-41` = 김서현(청년부)); the backfill is collision-free.
- **React app:** talks **only** to the edge function (no `supabase-js` / direct PostgREST), so
  the `VITE_SUPABASE_*` secrets in the original plan are **not** needed and RLS can't break it.

## Coordination note

The hardened function gates `/api/data` to super-admin (403). The live legacy `index.html`
(kiosk-first) calls `/api/data` unauthenticated on load, so **deploying the hardened function
degrades the legacy kiosk/admin** — but public check-in (`/api/checkin`) stays open. Therefore the
function deploy and the frontend flip happen close together; the only off-Sunday impact is ~2 min
of legacy kiosk/admin while Pages rebuilds. Public check-in is never down.

## Ordered steps

### Stage 1 — DB prep (reversible, zero impact on the live app)
1. Capture rollback artifacts (function v11 + data snapshot). ✅ done by background agent.
2. `apply_migration member_identity` — `members` table + `member_id` FKs + defensive `kakao_id`.
3. `apply_migration admin_roles` — `member_roles` table.
4. `apply_migration member_backfill` — one member per distinct device name; link
   `devices.member_id` + `attendance_log.member_id`; seed `member_roles` from
   `config.admin_devices` (live state preserved). *(Skip `20260611/12/13/14`: `611/13` are
   no-ops in prod, `12` would overwrite the richer live `admin_devices`, `14` is covered by
   `member_identity`'s defensive `ADD COLUMN`.)*
5. **Validate** (go/no-go): `unlinked_devices = 0`; `members ≈ 49`; `member_roles` has ≥1
   `super_admin` whose member owns a **personal** (non-ROSTER) device; attendance orphans = 0.

### Stage 2 — Flip (coordinated)
6. Deploy hardened function (MCP `deploy_edge_function`, `verify_jwt = false`, files `index.ts`
   + `auth.ts`). Smoke: `POST /api/admin/verify` with `DEV-B5D13150` + master password → 200
   super_admin; `GET /api/roster` same → all members; no-auth `/api/roster` → 401.
7. Flip frontend: merge the `deploy.yml` change (build `web/` → Pages) to `main`. Pages serves
   the React app (`VITE_API_BASE` defaults to the prod function URL).
8. `apply_migration rls` — enable RLS deny-all backstop (closes the direct-PostgREST PII hole).

### Stage 3 — Smoke test (production)
- Anonymous public check-in works; network tab shows **no roster/PII** payload.
- `DEV-B5D13150` + master password → React admin loads all members (super).
- A leader's personal device → only their 동산.
- PostgREST with the anon key returns `[]` for `members` / `attendance_log` (RLS).
- `get_advisors security` → no world-readable-table findings.

## Rollback (if any check fails)
- **Frontend:** revert the `deploy.yml` change on `main` → Pages republishes legacy `index.html`.
- **Function:** roll back to the previous version (v11) from the Supabase dashboard's function
  version history; or redeploy the repo function with the `/api/data` super-admin gate removed
  (re-open it) so the legacy app loads again.
- **RLS:** `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` for each table in `20260618_rls.sql`.
- **Schema:** `DROP TABLE member_roles; DROP TABLE members CASCADE;`
  `ALTER TABLE devices DROP COLUMN member_id; ALTER TABLE attendance_log DROP COLUMN member_id;`
  (existing device/config/attendance data is untouched by the additive migrations).
- **Data:** restore from `rollback/data-snapshot-pre-cutover.json` only if data was lost (the
  additive path does not delete or mutate existing rows beyond setting the new `member_id`).
