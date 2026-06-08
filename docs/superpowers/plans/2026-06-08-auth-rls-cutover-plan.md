# Auth + Stable Member IDs + RLS + Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REVISION 2026-06-08:** Admin auth is **device-id + master password** (no email / no Supabase Auth). Where this plan says Supabase Auth / `staff` / `staff_invites` / JWT / `getStaff` (Phases B, C, E), substitute: `member_roles` table keyed by member, a **hashed** master password (`check_admin_password`), `verifyAdmin(deviceId, password)`, and an admin **login = master password on a personal (non-`ROSTER-##`) device**. RLS is **pure deny-all** (drop the auth.uid() scoped policies — no user JWTs exist). Free tier only → validate via **local `supabase start`**, not a paid branch. See PR #48 + the spec revision banner.

**Goal:** Replace name-as-key + browser-only access control with stable member IDs, device+master-password admin auth, and server-enforced deny-all RLS — built and rehearsed on a free-tier local Supabase, then shipped in one coordinated legacy→React cutover.

**Architecture:** Hybrid enforcement (spec D1) — the `attendance-api` edge function stays the single gateway (service-role), verifies **device-id + master password** on admin endpoints and filters by role+scope in TypeScript; RLS is a pure deny-all backstop (no user JWTs reach PostgREST). Public check-in stays anonymous/device-based and PII-free.

**Tech Stack:** Supabase (Postgres + Auth + Edge Functions/Deno), Supabase branching + CLI, `@supabase/supabase-js`, React + Vite + TS (`web/`), Vitest, Deno test.

---

## ⛔ Execution gates (must clear before Phase F touches production)

This plan is **execution-ready but not started**. The standing rule holds: nothing touches the live backend until the spec (PR #45) is approved. Before running **Phase F**:

1. **Spec sign-off** — D1–D5 confirmed. This plan **assumes the recommended D1–D5**; if any flips, the affected phase notes what changes.
2. **Open items answered** (spec §8): super_admin seed **emails**; cutover **window** (non-Sunday); **magic-link only or +Google**.
3. **Collision report resolved** (Task A3) — a human marks each ambiguous name (e.g. 김서현) as one person or a split. Phases A–E run on a **Supabase branch** and are safe to build now once sign-off lands; only Phase F is destructive/production.

If executed before sign-off: stop at the end of Phase E (branch only) and hold Phase F.

---

## File structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260615_member_identity.sql` | Create `members`; add `member_id` FKs + indexes (structure only — no data move) |
| `supabase/migrations/20260616_member_backfill.sql` | Backfill `members` + `member_id` from `devices`/`attendance_log` (consumes collision resolution) |
| `supabase/migrations/20260617_staff_auth.sql` | `staff` + `staff_invites` tables + first-sign-in claim trigger |
| `supabase/migrations/20260618_rls.sql` | Enable RLS + deny-all + scoped SELECT policies on all tables |
| `supabase/functions/attendance-api/auth.ts` | Pure helpers: JWT→staff, scope predicate, roster filter (unit-tested) |
| `supabase/functions/attendance-api/auth.test.ts` | Deno tests for `auth.ts` |
| `supabase/functions/attendance-api/index.ts` | Add JWT verify on staff endpoints; replace `/api/data` with scoped `/api/roster` |
| `web/src/lib/supabase.ts` | `@supabase/supabase-js` client (anon key) |
| `web/src/stores/useAuth.ts` | Session store: magic-link/Google sign-in, sign-out, `onAuthStateChange` |
| `web/src/lib/api.ts` | Attach `Authorization: Bearer` from the session when present |
| `web/src/features/admin/LoginGate.tsx` | Staff login screen; gates the admin area |
| `web/src/features/admin/useRoster.ts` | Fetch the scoped `/api/roster` |
| `.github/workflows/deploy.yml` | Phase F: build `web/` to Pages instead of legacy `index.html` |
| `docs/superpowers/runbooks/cutover.md` | Phase F runbook + rollback (created in Task F1) |

**Decoupling note:** subsystems are interdependent (member_id underpins RLS + the function; auth underpins both; cutover ties all), so this is **one** phased plan rehearsed on a branch and cut over atomically — not independent sub-plans.

---

## Phase A — Member identity migration (Supabase branch)

### Task A1: Create the Supabase dev branch

**Files:** none (infra)

- [ ] **Step 1: Create a branch off production schema**

Run: `supabase branches create harden --project-ref loovulhchmmwagtvjnhc`
Expected: a branch with its own Postgres seeded from migrations. Capture the branch ref/connection string.

- [ ] **Step 2: Confirm migrations apply cleanly on the branch**

Run: `supabase db push --linked` (against the branch) or `supabase migration up`
Expected: all 11 existing migrations + apply with no error (the initial schema is migration-built per `20260501_initial_schema.sql`).

- [ ] **Step 3: Snapshot a production backup for later validation**

Run: `curl -s -H "X-Device-Id: <a-known-admin-device>" "https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api/api/backup" -o backup-pre.json`
Expected: a `version: 2` JSON with all devices/log/config. Keep as the parity baseline.

### Task A2: Schema migration — members + member_id

**Files:**
- Create: `supabase/migrations/20260615_member_identity.sql`

- [ ] **Step 1: Write the structural migration**

```sql
-- members: stable surrogate identity. PII + pastoral attributes live here; a member
-- may have many devices. devices/attendance_log gain a member_id FK. Names become a
-- mutable attribute of members instead of the join key.
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  notes text DEFAULT '',
  member_role text DEFAULT '',
  gender text DEFAULT '',
  phone text DEFAULT '',
  birth_date date,
  baptism_status text DEFAULT '해당없음',
  school_or_work text DEFAULT '',
  faith_duration text DEFAULT '',
  registration_date date,
  pastoral_visit_requested boolean DEFAULT false,
  is_new_member boolean DEFAULT false,
  new_member_edu_week1 boolean DEFAULT false,
  new_member_edu_week2 boolean DEFAULT false,
  kakao_id text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE devices        ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_devices_member ON devices(member_id);
CREATE INDEX IF NOT EXISTS idx_attlog_member ON attendance_log(member_id);
```

- [ ] **Step 2: Apply on the branch and verify the table exists**

Run: `supabase migration up` (branch)
Then: `psql "$BRANCH_DB_URL" -c "\d members"` and `-c "\d devices"`
Expected: `members` exists; `devices.member_id` + `attendance_log.member_id` columns present; indexes listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615_member_identity.sql
git commit -m "feat(db): members table + member_id FKs (structure only)"
```

### Task A3: Collision report (human-resolved)

**Files:** none (read-only query; output reviewed by a human)

- [ ] **Step 1: Run the collision report against the branch**

```sql
SELECT name,
       count(*) AS device_rows,
       count(DISTINCT coalesce(group_name,'') || '/' || coalesce(subgroup,'')) AS distinct_groups,
       count(DISTINCT phone) FILTER (WHERE coalesce(phone,'') <> '') AS distinct_phones,
       count(DISTINCT birth_date) FILTER (WHERE birth_date IS NOT NULL) AS distinct_birthdays,
       array_agg(id ORDER BY id) AS device_ids
FROM devices
GROUP BY name
HAVING count(DISTINCT coalesce(group_name,'') || '/' || coalesce(subgroup,'')) > 1
    OR count(DISTINCT phone) FILTER (WHERE coalesce(phone,'') <> '') > 1
    OR count(DISTINCT birth_date) FILTER (WHERE birth_date IS NOT NULL) > 1
ORDER BY name;
```
Expected: a small set of names whose devices disagree on group/phone/birthday — candidates for "two different people" (e.g. 김서현). Save as `collision-report.csv`.

- [ ] **Step 2: Human resolves each row**

For every reported name, a maintainer marks it **one person** (merge — default) or **split into N**, mapping each `device_id` to a person. Capture as a `collision_resolution` staging table on the branch:
```sql
CREATE TABLE collision_resolution (device_id text PRIMARY KEY, person_key text NOT NULL);
-- e.g. INSERT: ('ROSTER-12','김서현#대학부'), ('DEV-ab..','김서현#청년부')
```
**Do not proceed to A4 until every collision device_id has a `person_key`.** Names not in the report are implicitly one-person.

### Task A4: Backfill members + member_id

**Files:**
- Create: `supabase/migrations/20260616_member_backfill.sql`

- [ ] **Step 1: Write the backfill (non-collision names first)**

```sql
-- 1) One member per distinct non-collision name. For attributes, prefer a real
--    DEV- device's row (most likely to have current PII), else most recently updated.
INSERT INTO members (name, group_name, subgroup, notes, member_role, gender, phone,
  birth_date, baptism_status, school_or_work, faith_duration, registration_date,
  pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2, kakao_id)
SELECT DISTINCT ON (name)
  name, group_name, subgroup, notes, member_role, gender, phone, birth_date,
  baptism_status, school_or_work, faith_duration, registration_date,
  pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2, kakao_id
FROM devices d
WHERE NOT EXISTS (SELECT 1 FROM collision_resolution c WHERE c.device_id = d.id)
ORDER BY name, (id LIKE 'DEV-%') DESC, updated_at DESC NULLS LAST;

-- 2) Members for each resolved collision person (one per distinct person_key).
INSERT INTO members (name, group_name, subgroup, notes, member_role, gender, phone,
  birth_date, baptism_status, school_or_work, faith_duration, registration_date,
  pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2, kakao_id)
SELECT DISTINCT ON (c.person_key)
  d.name, d.group_name, d.subgroup, d.notes, d.member_role, d.gender, d.phone, d.birth_date,
  d.baptism_status, d.school_or_work, d.faith_duration, d.registration_date,
  d.pastoral_visit_requested, d.is_new_member, d.new_member_edu_week1, d.new_member_edu_week2, d.kakao_id
FROM collision_resolution c JOIN devices d ON d.id = c.device_id
ORDER BY c.person_key, (d.id LIKE 'DEV-%') DESC, d.updated_at DESC NULLS LAST;

-- 3) Link non-collision devices to members by name.
UPDATE devices d SET member_id = m.id
FROM members m
WHERE m.name = d.name AND d.member_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM collision_resolution c WHERE c.device_id = d.id);

-- 4) Link collision devices via the resolution table (match the member created from each person_key).
UPDATE devices d SET member_id = pm.id
FROM collision_resolution c
JOIN LATERAL (
  SELECT m.id FROM members m
  JOIN devices d2 ON d2.id = c.device_id AND d2.name = m.name
  LIMIT 1
) pm ON true
WHERE d.id = c.device_id AND d.member_id IS NULL;

-- 5) Link attendance_log: by device first, then by name fallback for orphan rows
--    (MANUAL-/BULK-/GUEST-/NAME- ids with no devices row).
UPDATE attendance_log a SET member_id = d.member_id FROM devices d
  WHERE a.device_id = d.id AND a.member_id IS NULL;
UPDATE attendance_log a SET member_id = m.id FROM members m
  WHERE a.member_id IS NULL AND a.name = m.name;
```

> **D4 note:** Step 4 is the simplified collision-link. For a 2-person split it works because each `person_key`'s devices share the same `name`; if a single name splits into people with *different* corrected names, set those names in `members` during Step 2 and adjust the join. Keep this in the migration so it's reviewable, not hidden in app code.

- [ ] **Step 2: Apply on the branch**

Run: `supabase migration up` (branch)
Expected: completes with no FK violations.

- [ ] **Step 3: Write validation assertions and run them**

```sql
-- (a) every device is linked
SELECT count(*) AS unlinked_devices FROM devices WHERE member_id IS NULL;            -- expect 0
-- (b) attendance orphans are only true guests (no devices row, no name match)
SELECT count(*) AS unlinked_attendance FROM attendance_log WHERE member_id IS NULL;  -- expect ~guests only
-- (c) per-member attendance-day count matches legacy per-name count for non-collision names
WITH legacy AS (
  SELECT name, count(DISTINCT date) d FROM attendance_log GROUP BY name
), bymember AS (
  SELECT m.name, count(DISTINCT a.date) d FROM members m JOIN attendance_log a ON a.member_id = m.id GROUP BY m.name
)
SELECT l.name, l.d AS legacy_days, b.d AS member_days
FROM legacy l JOIN bymember b USING (name)
WHERE l.d <> b.d
  AND l.name NOT IN (SELECT DISTINCT name FROM devices d JOIN collision_resolution c ON c.device_id=d.id);
-- expect 0 rows (collisions excluded — they legitimately re-split)
```
Expected: (a)=0, (b) equals the count of guest/orphan rows in `backup-pre.json`, (c) returns 0 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260616_member_backfill.sql
git commit -m "feat(db): backfill members + member_id (collision-aware)"
```

---

## Phase B — Staff identity + Supabase Auth (branch)

### Task B1: staff + staff_invites + claim trigger

**Files:**
- Create: `supabase/migrations/20260617_staff_auth.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  ministry text DEFAULT '',
  email text,
  created_at timestamptz DEFAULT now()
);

-- Pending invites keyed by email; claimed on first sign-in. Replaces the plaintext
-- admin_password + config.admin_devices entirely.
CREATE TABLE IF NOT EXISTS staff_invites (
  email text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('super_admin','leader','pastor','welcoming')),
  group_name text DEFAULT '',
  subgroup text DEFAULT '',
  ministry text DEFAULT '',
  member_id uuid REFERENCES members(id),
  created_at timestamptz DEFAULT now()
);

-- On first sign-in, promote a matching invite into a staff row.
CREATE OR REPLACE FUNCTION claim_staff_invite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO staff (user_id, member_id, role, group_name, subgroup, ministry, email)
  SELECT NEW.id, i.member_id, i.role, i.group_name, i.subgroup, i.ministry, NEW.email
  FROM staff_invites i WHERE i.email = NEW.email
  ON CONFLICT (user_id) DO NOTHING;
  DELETE FROM staff_invites WHERE email = NEW.email;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION claim_staff_invite();
```

- [ ] **Step 2: Apply + verify the trigger exists**

Run: `supabase migration up` (branch); then `psql -c "\dft" | grep claim_staff_invite`
Expected: function + trigger present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617_staff_auth.sql
git commit -m "feat(db): staff + staff_invites + first-sign-in claim trigger"
```

### Task B2: Enable Auth providers + seed invites

**Files:** none (Supabase Auth config) — **needs open-item answers**

- [ ] **Step 1: Enable providers (D2)**

In Supabase Auth settings for the branch: enable **Email (magic link / OTP)**; if D2 includes Google, enable **Google** with OAuth credentials. Set Site URL + redirect URLs to the web app origin.

- [ ] **Step 2: Seed super_admin invites (BLOCKED on emails)**

```sql
-- Emails are an open item (spec §8). Example shape only:
INSERT INTO staff_invites (email, role) VALUES
  ('<superadmin-1>@example.com', 'super_admin'),
  ('<superadmin-2>@example.com', 'super_admin')
ON CONFLICT (email) DO UPDATE SET role = excluded.role;
```
Expected: rows present; on first magic-link sign-in the trigger creates `staff` rows.

- [ ] **Step 3: Migrate existing leaders from config.admin_devices → staff_invites**

For each non-super entry in `config.admin_devices` (role `leader`/`pastor`/`welcoming` with group/subgroup/ministry), resolve the device→member→ a contact email (collected by the maintainer) and insert an invite. Capture as a one-off SQL script reviewed alongside the collision resolution.

---

## Phase C — Hardened edge function (branch)

### Task C1: Extract + test the auth/scope helpers (TDD)

**Files:**
- Create: `supabase/functions/attendance-api/auth.ts`
- Test: `supabase/functions/attendance-api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from "jsr:@std/assert";
import { scopeFilter, type Staff } from "./auth.ts";

Deno.test("super_admin sees everything (no filter)", () => {
  const s: Staff = { userId: "u", role: "super_admin", group: "", subgroup: "", ministry: "" };
  assertEquals(scopeFilter(s, false), { all: true });
});

Deno.test("leader is scoped to their group+subgroup in semester mode", () => {
  const s: Staff = { userId: "u", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM" };
  assertEquals(scopeFilter(s, false), { all: false, groups: ["청년부"], subgroup: "건영동산" });
});

Deno.test("KM leader spans both depts in summer mode (합동)", () => {
  const s: Staff = { userId: "u", role: "leader", group: "청년부", subgroup: "건영동산", ministry: "KM" };
  assertEquals(scopeFilter(s, true), { all: false, groups: ["대학부", "청년부"], subgroup: "건영동산" });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `deno test supabase/functions/attendance-api/auth.test.ts`
Expected: FAIL (`scopeFilter` not found).

- [ ] **Step 3: Implement `auth.ts`**

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

export interface Staff {
  userId: string;
  memberId?: string | null;
  role: "super_admin" | "leader" | "pastor" | "welcoming";
  group: string;
  subgroup: string;
  ministry: string;
}

export type Scope = { all: true } | { all: false; groups: string[]; subgroup: string };

// Mirror of the legacy ACL: super/pastor see all; a KM leader sees both depts in
// summer mode (합동) but only their own dept in semester mode; subgroup always pins
// to their 동산.
export function scopeFilter(staff: Staff, summerMode: boolean): Scope {
  if (staff.role === "super_admin" || staff.role === "pastor") return { all: true };
  if (staff.role === "leader") {
    const groups = summerMode && (staff.group === "대학부" || staff.group === "청년부")
      ? ["대학부", "청년부"]
      : [staff.group];
    return { all: false, groups, subgroup: staff.subgroup };
  }
  return { all: false, groups: [staff.group].filter(Boolean), subgroup: staff.subgroup };
}

// Verify a bearer JWT and load the caller's staff row. Returns null when unauthenticated
// or not staff. Uses a service-role client to read the staff table.
export async function getStaff(authHeader: string | null): Promise<Staff | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userRes } = await sb.auth.getUser(jwt);
  const uid = userRes?.user?.id;
  if (!uid) return null;
  const { data } = await sb.from("staff").select("*").eq("user_id", uid).single();
  if (!data) return null;
  return {
    userId: uid, memberId: data.member_id, role: data.role,
    group: data.group_name || "", subgroup: data.subgroup || "", ministry: data.ministry || "",
  };
}
```

- [ ] **Step 4: Run the test (expect pass)**

Run: `deno test supabase/functions/attendance-api/auth.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/attendance-api/auth.ts supabase/functions/attendance-api/auth.test.ts
git commit -m "feat(fn): JWT→staff + scope-filter helpers (tested)"
```

### Task C2: Add scoped `GET /api/roster`; retire `GET /api/data`

**Files:**
- Modify: `supabase/functions/attendance-api/index.ts`

- [ ] **Step 1: Add the roster endpoint (members-based, scoped)**

Insert near the old `/api/data` handler:
```ts
import { getStaff, scopeFilter } from "./auth.ts";

if (req.method === "GET" && p === "/api/roster") {
  const staff = await getStaff(req.headers.get("Authorization"));
  if (!staff) return fail(401, "Sign in required");
  const cfg = await getCfg(sb);
  const scope = scopeFilter(staff, !!cfg.summer_mode);
  let q = sb.from("members").select("*");
  if (!scope.all) {
    q = q.in("group_name", scope.groups);
    if (scope.subgroup) q = q.eq("subgroup", scope.subgroup);
  }
  const { data: members } = await q;
  const ids = (members || []).map((m: any) => m.id);
  const { data: logs } = ids.length
    ? await sb.from("attendance_log").select("*").in("member_id", ids).order("ts", { ascending: false })
    : { data: [] };
  return ok({ members: members || [], log: logs || [] });
}
```

- [ ] **Step 2: Lock down `/api/data`**

Replace the body of the `GET /api/data` handler so it requires a super_admin (transitional; remove entirely once the React client no longer calls it):
```ts
if (req.method === "GET" && p === "/api/data") {
  const staff = await getStaff(req.headers.get("Authorization"));
  if (staff?.role !== "super_admin") return fail(403, "Not authorized");
  // …existing full dump (super-admin only)…
}
```

- [ ] **Step 3: Deploy to the branch + smoke test**

Run: `supabase functions deploy attendance-api --project-ref <branch-ref> --no-verify-jwt`
Then: `curl .../api/roster` with **no** auth → expect 401; with a leader JWT → expect only their 동산's members; `curl .../api/data` with no auth → expect 403.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/attendance-api/index.ts
git commit -m "feat(fn): scoped /api/roster; gate /api/data to super admin"
```

### Task C3: Keep public check-in PII-free (regression guard)

**Files:**
- Modify: `supabase/functions/attendance-api/index.ts` (only if a leak is found)

- [ ] **Step 1: Audit the anonymous endpoints**

Confirm `/api/checkin`, `/api/self-register`, `/api/guest-checkin`, `GET /api/config` return only the caller's own status (never roster/PII). These already do (spec §1); no change expected.

- [ ] **Step 2: Verify with an unauthenticated curl**

Run each anonymous endpoint with no Authorization header against the branch; assert the JSON contains no other members' phone/birth_date/kakao_id.
Expected: only the caller's name/time/total.

---

## Phase D — RLS (branch)

### Task D1: Enable RLS + deny-all + scoped policies

**Files:**
- Create: `supabase/migrations/20260618_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE events               ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites        ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies = deny-all for those roles. service_role (the edge
-- function) bypasses RLS, so the function remains the enforcement path.

-- Defense-in-depth: if a client ever queries with a user JWT directly, still scope it.
CREATE POLICY members_super_read ON members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role IN ('super_admin','pastor')));
CREATE POLICY members_leader_read ON members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role = 'leader'
      AND s.group_name = members.group_name
      AND (s.subgroup = '' OR s.subgroup = members.subgroup)
  ));
CREATE POLICY attlog_scoped_read ON attendance_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM members m WHERE m.id = attendance_log.member_id AND (
      EXISTS (SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role IN ('super_admin','pastor'))
      OR EXISTS (SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role = 'leader'
                 AND s.group_name = m.group_name AND (s.subgroup = '' OR s.subgroup = m.subgroup))
    )
  ));
CREATE POLICY staff_self_read ON staff FOR SELECT TO authenticated USING (user_id = auth.uid());
```

- [ ] **Step 2: Apply + verify deny-all for anon**

Run: `supabase migration up` (branch). Then with the **anon** key (no JWT):
```bash
curl "$BRANCH_URL/rest/v1/members?select=*" -H "apikey: $ANON_KEY"
```
Expected: `[]` (RLS denies). Repeat for `attendance_log`, `devices` → all empty.

- [ ] **Step 3: Verify scoped read with a leader JWT**

Sign in a seeded leader; call the same PostgREST URL with their `Authorization: Bearer`. Expect only their 동산's members.

- [ ] **Step 4: Verify the edge function still works (service role bypass)**

`curl .../api/roster` with the leader's JWT → still returns their scope (function path unaffected by RLS).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618_rls.sql
git commit -m "feat(db): enable RLS deny-all backstop + scoped SELECT policies"
```

---

## Phase E — Web auth client (branch backend)

### Task E1: Supabase client + env

**Files:**
- Create: `web/src/lib/supabase.ts`
- Modify: `web/.env.example` (document `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)

- [ ] **Step 1: Install the SDK**

Run: `npm --prefix web i @supabase/supabase-js`
Expected: added to `web/package.json`.

- [ ] **Step 2: Create the client**

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const supabase = createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/supabase.ts web/.env.example web/package.json web/package-lock.json
git commit -m "feat(web): supabase-js client + env"
```

### Task E2: Auth store (TDD)

**Files:**
- Create: `web/src/stores/useAuth.ts`
- Test: `web/src/stores/useAuth.test.ts`

- [ ] **Step 1: Write the failing test (mock supabase)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/supabase', () => {
  const listeners: any[] = []
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        onAuthStateChange: (cb: any) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } } },
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        __emit: (s: any) => listeners.forEach((l) => l('SIGNED_IN', s)),
      },
    },
  }
})

beforeEach(() => { localStorage.clear() })

describe('useAuth', () => {
  it('starts signed-out and stores a session on auth change', async () => {
    const { useAuth } = await import('./useAuth')
    expect(useAuth.getState().session).toBeNull()
    const { supabase } = await import('../lib/supabase')
    ;(supabase.auth as any).__emit({ access_token: 'jwt', user: { email: 'a@b.c' } })
    expect(useAuth.getState().session?.access_token).toBe('jwt')
  })

  it('sendMagicLink delegates to signInWithOtp', async () => {
    const { useAuth } = await import('./useAuth')
    const { supabase } = await import('../lib/supabase')
    await useAuth.getState().sendMagicLink('a@b.c')
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'a@b.c' })
  })
})
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `npm --prefix web test -- useAuth`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

```ts
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  ready: boolean
  sendMagicLink: (email: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => {
  supabase.auth.getSession().then(({ data }) => set({ session: data.session, ready: true }))
  supabase.auth.onAuthStateChange((_e, session) => set({ session }))
  return {
    session: null,
    ready: false,
    sendMagicLink: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({ email })
      return { error: error?.message ?? null }
    },
    signInWithGoogle: async () => { await supabase.auth.signInWithOAuth({ provider: 'google' }) },
    signOut: async () => { await supabase.auth.signOut() },
  }
})
```

- [ ] **Step 4: Run the test (expect pass)**

Run: `npm --prefix web test -- useAuth`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/useAuth.ts web/src/stores/useAuth.test.ts
git commit -m "feat(web): auth store (magic-link/google) with tests"
```

### Task E3: Attach the bearer token in `api.ts` (TDD)

**Files:**
- Modify: `web/src/lib/api.ts`
- Test: `web/src/lib/api.test.ts` (add a case)

- [ ] **Step 1: Add a failing test**

```ts
it('sends Authorization when a session token is present', async () => {
  const { setAuthToken, api } = await import('./api')
  setAuthToken('jwt-123')
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api('GET', '/api/roster')
  const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
  expect(headers.Authorization).toBe('Bearer jwt-123')
})
```

- [ ] **Step 2: Run; confirm fail**

Run: `npm --prefix web test -- api`
Expected: FAIL (`setAuthToken` not exported).

- [ ] **Step 3: Implement a token holder + header**

In `api.ts`, add module state set from the auth store, and include the header:
```ts
let authToken: string | null = null
export function setAuthToken(token: string | null) { authToken = token }
// inside api(), after building headers:
if (authToken) headers['Authorization'] = `Bearer ${authToken}`
```
Wire it: in `useAuth`, call `setAuthToken(session?.access_token ?? null)` whenever the session changes.

- [ ] **Step 4: Run (expect pass)**

Run: `npm --prefix web test -- api`
Expected: PASS. Then full suite: `npm --prefix web test` → all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts web/src/stores/useAuth.ts
git commit -m "feat(web): attach bearer token to api requests"
```

### Task E4: Login gate + scoped roster

**Files:**
- Create: `web/src/features/admin/LoginGate.tsx`
- Create: `web/src/features/admin/useRoster.ts`
- Modify: `web/src/features/admin/AdminShell.tsx`

- [ ] **Step 1: `useRoster` hook**

```ts
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

export interface Member { id: string; name: string; group_name: string; subgroup: string; /* …PII fields… */ }
export interface RosterData { members: Member[]; log: unknown[] }
export const useRoster = (enabled: boolean) =>
  useQuery({ queryKey: ['roster'], queryFn: () => api<RosterData>('GET', '/api/roster'), enabled })
```

- [ ] **Step 2: `LoginGate` (magic-link + optional Google)**

A small form: email input → `useAuth().sendMagicLink`; "check your email" confirmation; optional Google button. Use existing `Input`/`Button`. Warm design.

- [ ] **Step 3: Gate the admin shell**

```tsx
export function AdminShell() {
  const { session, ready } = useAuth()
  if (!ready) return <Loading/>
  if (!session) return <LoginGate/>
  return <AdminHome/> // scoped roster via useRoster(true)
}
```

- [ ] **Step 4: Verify against the branch backend**

Point `VITE_SUPABASE_URL`/`VITE_API_BASE` at the branch; sign in as a leader; confirm the admin area loads only their 동산's members.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/admin/
git commit -m "feat(web): staff login gate + scoped roster"
```

### Task E5: Full branch verification

- [ ] **Step 1:** `npm --prefix web run build` → clean. `npm --prefix web test` → all green. `deno test supabase/functions/attendance-api/` → green.
- [ ] **Step 2:** Manual matrix on the branch: anon check-in works + leaks nothing; leader sees only their scope; super sees all; pastor read-only; PostgREST anon returns `[]`.
- [ ] **Step 3:** Open a PR for Phases A–E (branch-built, not yet cut over). Title: `feat: auth + member IDs + RLS (branch-validated, pre-cutover)`.

---

## Phase F — Coordinated cutover (PRODUCTION — gated)

> Do not start until all execution gates are clear. Rehearse the whole sequence on the branch first.

### Task F1: Write the cutover runbook

**Files:**
- Create: `docs/superpowers/runbooks/cutover.md`

- [ ] **Step 1:** Document the exact ordered steps below + rollback, with the responsible person and the go/no-go check after each. Commit.

### Task F2: Pre-flight (no prod change)

- [ ] `curl .../api/backup` on **production** → `backup-prod-<date>.json`. Verify it parses and row counts match the dashboard.
- [ ] Confirm the collision resolution + leader-email invites are finalized and reviewed.
- [ ] Confirm a non-Sunday off-hours window (check-in only matters Sun 13:00–15:00 ET).

### Task F3: Migrate + harden production (in the window)

- [ ] Post a brief maintenance notice / freeze writes.
- [ ] Apply migrations to prod: `supabase db push` (member_identity → backfill → staff_auth → rls). Run the Task A4 validation queries against prod; **go/no-go**.
- [ ] Deploy the hardened function: `supabase functions deploy attendance-api --project-ref loovulhchmmwagtvjnhc --no-verify-jwt` (JWT is verified selectively *inside* the function; public check-in stays anonymous).
- [ ] Seed super_admin invites (Task B2) with the real emails.

### Task F4: Flip the frontend

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1:** Replace the "Prepare static files" step (which copies legacy `index.html`) with a `web/` build:
```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm, cache-dependency-path: web/package-lock.json }
      - name: Build web
        run: npm ci --prefix web && npm --prefix web run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - name: Stage dist
        run: { mkdir -p dist && cp -r web/dist/* dist/ }
```
(Keep `upload-pages-artifact` pointing at `./dist`.)
- [ ] **Step 2:** Push to `main` → Pages publishes the React app. **go/no-go.**

### Task F5: Smoke test (production)

- [ ] Anonymous public check-in works and the network tab shows **no roster/PII** payload.
- [ ] A super_admin signs in (magic link) → sees all members.
- [ ] A leader signs in → sees only their 동산.
- [ ] PostgREST with the anon key returns `[]` for `members`/`attendance_log`.
- [ ] Kiosk: confirm the reserved `kiosk` path is either wired or explicitly disabled pending Phase 3.

### Task F6: Rollback (if any F5 check fails)

- [ ] Re-point `deploy.yml` to legacy `index.html`; push to `main` (Pages reverts).
- [ ] Redeploy the **previous** edge function: `git revert` the function commit + `supabase functions deploy`.
- [ ] `POST .../api/restore` with `backup-prod-<date>.json`; disable RLS (`ALTER TABLE … DISABLE ROW LEVEL SECURITY`).
- [ ] Confirm the legacy app is fully functional, then debug offline.

---

## Self-review

**Spec coverage:** Auth model → Phase B + E (Task B1–B2, E2–E4). Stable member IDs + migration → Phase A (A2–A4). RLS → Phase D (D1). Coordinated cutover → Phase F. Public check-in stays anonymous/PII-free → C3. Kiosk principal reserved → noted in F5 (Phase 3 follow-up). ✅

**Placeholder scan:** No "TBD/handle errors" placeholders; the only intentional blanks are the **open-item** values (super_admin emails, providers) and the **human-resolved** collision table — both flagged as execution gates, not plan gaps. ✅

**Type consistency:** `Staff`/`scopeFilter`/`Scope` defined in C1 and reused in C2 + D1 predicates. `setAuthToken` (E3) consumed by `useAuth` (E2/E3). `useRoster`/`Member` (E4) align with `/api/roster` shape (C2). ✅

**Contingencies if D-decisions flip:** D1→full RLS (Approach B) ⇒ Phase C shrinks (clients hit PostgREST directly) and D1 policies become primary not backstop. D2→magic-link only ⇒ drop Google in B2/E2/E4. D4 split-with-renames ⇒ extend A4 Step 2 names. D5→zero-downtime ⇒ Phase F becomes dual-write (larger).
