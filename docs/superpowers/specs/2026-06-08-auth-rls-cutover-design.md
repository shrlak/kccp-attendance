# Auth + Stable Member IDs + RLS + Coordinated Cutover — Design

**Date:** 2026-06-08
**Status:** D1–D5 SIGNED OFF (2026-06-08). Nothing touches production until the coordinated cutover.

> **REVISION 2026-06-08 (per maintainer):** **D2 changed** — admin auth is **device-id + master password** (legacy-style, hardened), **not** email / Supabase Auth. Roles attach to **personal (non-`ROSTER-##`) devices/members**, never seed stubs; the master password is now **hashed** (bcrypt). RLS simplifies to pure **deny-all** (no user JWTs ever reach PostgREST; the service-role edge function is the sole gateway). The core PII fix is unchanged: the world-readable `/api/data` is replaced by an admin-verified, role-scoped roster. Implemented in PR #48; the `staff`/`auth.users` machinery in the body below is superseded by `member_roles` + `check_admin_password`.
**Scope:** The foundational hardening phase of the React re-platform. Replaces device-string/name-string identity and browser-only access control with real authentication, stable member IDs, and server-enforced authorization, shipped together with the legacy→React cutover ("option 1").

> ⚠️ This is the highest-stakes design of the re-platform: production Supabase, real PII, real users, and a destructive-by-nature data migration. This document is the artifact to review. No migration is run, no RLS is enabled, no function is deployed, and the deploy pipeline is not changed until this spec is approved.

---

## 0. Decisions requiring your sign-off

These are the few places where I made a call you should explicitly confirm (everything else follows from the codebase). Flip any of them on review.

| # | Decision | My call | Why | If you disagree |
|---|----------|---------|-----|-----------------|
| D1 | **Enforcement layer** | **Hybrid**: keep the `attendance-api` edge function as the single gateway (service-role), enforce auth + role + scope *inside* it; enable RLS as a *deny-all backstop*. | The whole app already routes through this one function; leader scoping (incl. `summer_mode` 합동 remap) is complex TypeScript that does not translate cleanly to SQL RLS predicates. Smallest safe change + defense-in-depth. | Alt = full PostgREST + RLS with per-table policies and direct client queries (§2, Approach B). Bigger rewrite; defer. |
| D2 | **Staff auth method** | **Supabase Auth, magic-link (email OTP) primary + Google OAuth optional.** | No passwords to store (kills the plaintext `admin_password`). Email/Google are reliable for this audience. | Phone OTP (needs Twilio + cost) or email+password. |
| D3 | **Public check-in stays anonymous** | **Yes** — members never log in; PWA keeps the `kccp-device-id` localStorage identity and a narrow anonymous endpoint that never returns roster PII. | Preserves the "open and tap" low-friction UX, which is the product's core. | Anonymous Supabase sessions per device (uniform JWT, §2 Approach C) — more elegant for RLS, more migration. |
| D4 | **True-collision handling** | Generate a **collision report** for human resolution *before* the migration; do not auto-split or auto-merge ambiguous names. | The 김서현 collision means name alone is unsafe as a merge key; only a human knows if two same-named rows are one person or two. | Auto-merge-by-name (unsafe) or treat every device as its own member (loses history continuity). |
| D5 | **Cutover style** | **Single short maintenance window on a non-Sunday**, validated on a Supabase branch first, with a tested rollback. | Check-in only matters Sundays 13:00–15:00 ET (`checkin_days=[0]`, window 780–900). A weekday window has near-zero user impact. | Zero-downtime dual-write (much more engineering for a once-only flip). |

---

## 1. Current state (what we are replacing)

Grounded in `supabase/functions/attendance-api/index.ts`, `supabase/migrations/*`, and `web/src/lib/*`.

**Identity & data model**
- A **"member" is every `devices` row sharing the same `name` string.** `getDevsByName(name)` is the join primitive; renames bulk-update `devices` *and* `attendance_log` by name string. There is no member key.
- Device IDs encode origin: `DEV-<uuid>` (real PWA install, from localStorage `kccp-device-id`), `ROSTER-NN` (seeded roster stubs), `NEW-<ts>` (kiosk 새가족), `MANUAL-/BULK-/GUEST-<ts>`, `NAME-<name>` (event attendees).
- `attendance_log` is denormalized (carries `device_id` **and** `name`/`group`/`subgroup`). Orphan rows (MANUAL-/BULK-/GUEST-/NAME-) have no matching `devices` row and are keyed only by `name`.
- PII lives on `devices`: `phone`, `birth_date`, `kakao_id`, `gender`, `school_or_work`, plus pastoral fields.

**"Auth" today**
- The edge function runs with the **service-role key** → it bypasses RLS entirely. RLS, even if enabled, would do nothing to this path.
- `verify_jwt=false`, `CORS: *`. **`GET /api/data` returns the entire roster (all PII) + all attendance with no auth check.** The 동산지기/부동산지기 scoping that "limits" a leader to their own 동산 is **100% browser-side cosmetics** — the wire already carried everything. This is the PII hole.
- "Admin" = your `device_id` (or any device sharing your `name`) is present in `config.admin_devices` (a JSONB array). Bootstrap: empty array ⇒ everyone is admin.
- Becoming admin: `POST /api/admin/add` with the shared **plaintext** `config.admin_password` (`'kccpwelcome'`); only a super admin may grant (except first-run).

**Three distinct "role" concepts — do not conflate**
1. **Access role** — `config.admin_devices[].role` ∈ {`super`, `leader`, `pastor` (read-only), `welcoming` (새가족)} with `group`/`subgroup`/`ministry` scope. *This* is authorization.
2. **Pastoral `member_role`** — on `devices`/`attendance_log` ∈ {pastor, elder, deacon, mentor, visitor}. A display/category attribute, **not** access.
3. **`dongsan_leaders`** (config) — who renders with 👑/⭐ per 동산, keyed by **name**. Display only.

**Client (web/)**
- `api.ts` sends only `X-Device-Id`; **no Authorization header / JWT**. No `@supabase/supabase-js` dependency yet (stack: react-query, zustand, react-router).
- `deploy.yml` deploys **legacy `index.html`** to Pages and deploys the edge function with `--no-verify-jwt`. `web/` is not deployed (no cutover yet).

---

## 2. Approaches considered (enforcement layer — D1)

**Approach A — Hybrid gateway (RECOMMENDED).** Clients keep calling the edge function. The function verifies a Supabase JWT for all staff/PII endpoints, looks up role+scope from a `staff` table, and filters results server-side (reusing the existing summer_mode logic in TS). Tables get RLS with **deny-all** for `anon`/`authenticated`; only `service_role` (the function) reaches them. Public check-in endpoints remain anonymous but are rewritten to never return the roster.
- *Pros:* real server-side enforcement now; minimal client churn (keep typed `api.ts`); complex scoping stays in TS; RLS is a hard backstop if the service key ever leaks into a client.
- *Cons:* function remains a single chokepoint; RLS is "belt" not "primary".

**Approach B — Full PostgREST + RLS.** Clients use the anon key + user JWT and query tables directly; RLS does all enforcement; public check-in via `SECURITY DEFINER` RPC.
- *Pros:* Supabase-native; no function bottleneck.
- *Cons:* large client-layer rewrite; leader scope + summer_mode as pure SQL is brittle; still needs a definer function for check-in. **Deferred** — can migrate incrementally later because Approach A already enables RLS-correct policies (§5).

**Approach C — Anonymous Supabase sessions for members.** Every device gets a Supabase anonymous identity; uniform JWT everywhere.
- *Pros:* one auth model; RLS applies uniformly.
- *Cons:* migrating existing `kccp-device-id` installs to anon users is extra risk; anonymous users are farmable; over-engineered for "open and tap." **Rejected for v1.**

---

## 3. Auth model (D2, D3)

**Principals**
- `anonymous` — the public PWA check-in. No login. Identity = `kccp-device-id`. Can: record own attendance, self-register a name, read public config and **only its own** status. Cannot read the roster.
- `staff` — authenticated via Supabase Auth (magic link / Google). Backed by a `staff` row (`auth.uid()` → role + scope). Roles: `super_admin`, `leader` (scoped to `group`+`subgroup`+`ministry`), and (reserved) `pastor` (read-only), `welcoming` (새가족 only).
- `kiosk` — reserved principal for Phase 3 (kiosk check-in currently calls the admin-only `/api/admin/checkin`). The auth model reserves a dedicated short-lived kiosk token / `kiosk` role; detail deferred, but called out so it isn't designed out.

**New table: `staff`**
```sql
CREATE TABLE staff (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id  uuid REFERENCES members(id) ON DELETE SET NULL, -- which member this staff *is* (for 동산지기 self-link)
  role       text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup   text DEFAULT '',
  ministry   text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
```
- Replaces `config.admin_devices` and the plaintext `admin_password` entirely.
- Super admin invites a leader by email; on first magic-link sign-in a `staff` row is created/linked (a pending-invite table or pre-seeded `staff` row keyed by email→uid on first login).
- Bootstrap: seed the first `super_admin`(s) directly (김호연, 박주연 by email) during cutover (§6).

**Auth flow (staff)**
1. Staff opens the admin area → `@supabase/supabase-js` client (anon key) → `signInWithOtp({email})` or `signInWithOAuth({google})`.
2. Supabase issues a JWT; the React client attaches `Authorization: Bearer <access_token>` to `api.ts` requests.
3. The function verifies the JWT (`supabase.auth.getUser(jwt)`), loads the `staff` row, derives role+scope, enforces per-endpoint.

**Client impact (web/)**
- Add `@supabase/supabase-js`; a thin `auth` store (zustand) holding session; `api.ts` adds the `Authorization` header when a session exists (keeps `X-Device-Id` for the anonymous path).
- Public check-in screens require **no** session (unchanged UX).

---

## 4. Stable member IDs + migration (D4)

**Target model**
```sql
CREATE TABLE members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  group_name   text DEFAULT '',
  subgroup     text DEFAULT '',
  -- PII + pastoral attributes move here (phone, birth_date, kakao_id, gender,
  -- school_or_work, faith_duration, baptism_status, registration_date,
  -- pastoral_visit_requested, is_new_member, new_member_edu_week1/2, member_role, notes)
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE devices        ADD COLUMN member_id uuid REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE attendance_log ADD COLUMN member_id uuid REFERENCES members(id) ON DELETE SET NULL;
```
- `member_id` becomes the canonical key. `devices` rows become *identity tokens* for a member (a member may have several). `device_id` columns are retained for provenance/debugging.
- Name becomes a mutable attribute of `members`; renames touch one row, not N.
- `event_attendees` (`device_id='NAME-<name>'`) and `config.dongsan_leaders` (name-keyed) are re-pointed to `member_id`.

**Migration algorithm (run on a branch first, dry-run report, reversible)**
1. **Backup** production (`GET /api/backup`) and snapshot the branch.
2. **Build `members`**: one member per distinct `devices.name`, carrying its PII/group.
3. **Collision report** (D4): list every name where the underlying devices disagree on `group`/`subgroup`/`phone`/`birth_date` (signals of two different people, e.g. 김서현). Output as a review table; a human marks each as *one person* (merge) or *split into N*. The migration consumes the resolved mapping. **No ambiguous name is auto-resolved.**
4. **Backfill `devices.member_id`** by name→member (post-resolution).
5. **Backfill `attendance_log.member_id`**: join on `device_id`→`devices.member_id`; for orphan logs (MANUAL-/BULK-/GUEST-/NAME-) fall back to name→member, else attach to a synthesized guest member.
6. **Migrate config**: `dongsan_leaders` name→member_id; seed `staff` from the resolved `admin_devices` roles (super/leader/scope preserved) keyed to the inviting emails.
7. **Validate**: per-member attendance counts match pre-migration `countAtt(name)`; row counts reconcile; spot-check known members (김호연, 박주연) and the resolved collisions.
8. Existing `supersedeRosterPlaceholders` logic folds into step 4 (ROSTER stubs absorbed into the member alongside DEV devices).

**Function impact:** `getDevsByName` → `getMember`/`getDevicesForMember`; name-based updates become member-id updates; reads return members, not raw devices.

---

## 5. RLS policies

Enable RLS on every data table: `members`, `devices`, `attendance_log`, `config`, `audit_log`, `events`, `event_attendees`, `pending_registrations`, `staff`.

**Backstop layer (primary enforcement = the function, per D1)**
- Default: **deny all** for `anon` and `authenticated`. `service_role` bypasses RLS, so the edge function (which holds role+scope logic) is the only working path. This alone closes the PII hole the moment the legacy no-auth `/api/data` is retired.

**Defense-in-depth policies (so direct user-JWT queries are *also* correct, enabling a future Approach B):**
```sql
-- super_admin sees everything
CREATE POLICY staff_super_all ON members FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role = 'super_admin'));

-- leader sees only their group+subgroup (summer_mode 합동 handled in the function/RPC layer)
CREATE POLICY staff_leader_scope ON members FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role = 'leader'
    AND s.group_name = members.group_name
    AND (s.subgroup = '' OR s.subgroup = members.subgroup)
));
```
- Analogous SELECT policies on `attendance_log`/`devices` via their `member_id` → member scope.
- `staff` table: a user may read their own row; only `super_admin` may read/write all (manage roles).
- Writes (insert/update/delete) for staff endpoints remain via the service-role function; no `authenticated` write policies in v1.

**Public check-in path (anonymous, no JWT):** kept inside the edge function under `service_role`, rewritten so its responses contain only the caller's own data:
- `POST /api/checkin`, `/api/self-register`, `/api/guest-checkin` — write attendance / register a name; return only that device's status (time, own total, group). **Never** the roster.
- `GET /api/config` — only the public subset (already the case).
- **`GET /api/data` is removed** and replaced by **`GET /api/roster`** which *requires* a staff JWT and returns only the caller's allowed members (super → all; leader → their 동산). This is the single change that actually closes the exposure.

---

## 6. Coordinated cutover (D5)

Enabling auth/RLS earlier breaks the still-live legacy app (it depends on no-auth `/api/data`), so the flip is one move.

**Pre-window (no production change)**
1. Full backup (`/api/backup`) + branch snapshot.
2. Apply all migrations to a **Supabase preview branch**; run the migration dry-run; resolve the collision report; validate (§4.7).
3. Build & test the React app (incl. new auth) against the branch.
4. Prepare seeds: first `super_admin` emails (김호연, 박주연); prepare the `deploy.yml` change (build `web/` dist instead of copying `index.html`; keep the edge-function deploy with `--no-verify-jwt` because public check-in is JWT-verified *selectively inside* the function, not at the platform edge).

**Window (off-hours, non-Sunday)**
5. Freeze writes / brief maintenance note.
6. Run the member-ID migration on production.
7. Deploy the hardened edge function (JWT verify on staff endpoints, scoped `/api/roster`, anonymous check-in preserved).
8. Enable RLS on all tables.
9. Deploy React to GitHub Pages (swap `deploy.yml` to publish `web/` dist).
10. Seed the super_admin `staff` rows.
11. **Smoke test:** staff magic-link login → scoped roster; a leader sees only their 동산; anonymous public check-in works and leaks no roster; kiosk path accounted for (or explicitly disabled pending Phase 3).

**Rollback** (if smoke test fails): restore the backup, redeploy the *legacy* edge function (no-auth) **and** re-point Pages to legacy `index.html`, disable RLS. Because the legacy app needs no-auth `/api/data`, rollback must revert function + frontend together — scripted and tested on the branch beforehand.

**After cutover (separate phases, on the hardened base):** admin core (Sheet/Today/Members+roles), admin extended (newcomers/devices/admins/settings/summer-mode), kiosk (the reserved `kiosk` principal), analytics/reports/export.

---

## 7. Out of scope / YAGNI

- Full PostgREST migration (Approach B) — policies are written to allow it later, but clients keep using the function in v1.
- Anonymous Supabase sessions for members (Approach C).
- Kiosk auth implementation (Phase 3) — only the principal is reserved here.
- Per-field PII encryption, audit-log immutability hardening — note as future, not in this phase.

## 8. Open items for your review

1. Confirm D1–D5.
2. Which emails seed the first `super_admin`(s)? (assumed 김호연 + 박주연 from the role migration).
3. Acceptable maintenance-window day/time (assumed any non-Sunday evening ET).
4. Magic-link only, or also enable Google OAuth at launch (D2)?
