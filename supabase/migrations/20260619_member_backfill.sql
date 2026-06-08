-- Member backfill — build `members` from `devices` and link everything (plan A4).
-- Collision-free per the 2026-06-08 report (distinct names == device count), so name
-- is a safe member key with no human splits required.
--
-- ROSTER-OVERWRITE RULE (per maintainer): a member's canonical info prefers a PERSONAL
-- (non-ROSTER-##) device; ROSTER info is used ONLY when no personal device exists for
-- that name. So when someone registers their own device, their real info wins and is
-- never overwritten by a leftover ROSTER seed stub — the stub's info only seeds the
-- member while the stub is still the current/only record.
--
-- Roles migrate to member_roles for PERSONAL-device admins only; ROSTER-stub grants are
-- intentionally dropped — those people re-register a personal device to regain a role.
--
-- ⚠️ Data migration — runs at cutover (or after the additive structural migrations) as
-- the table owner, which bypasses RLS. Validate before production.

-- 1) One member per distinct name. DISTINCT ON keeps the first row per name; the
--    ORDER BY makes that a personal (non-ROSTER) device when one exists, else the
--    (newest) ROSTER stub — i.e., the overwrite rule.
INSERT INTO members (name, group_name, subgroup, notes, member_role, gender, phone,
  birth_date, baptism_status, school_or_work, faith_duration, registration_date,
  pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2, kakao_id)
SELECT DISTINCT ON (name)
  name, group_name, subgroup, notes, member_role, gender, phone, birth_date,
  baptism_status, school_or_work, faith_duration, registration_date,
  pastoral_visit_requested, is_new_member, new_member_edu_week1, new_member_edu_week2, kakao_id
FROM devices
ORDER BY name, (id NOT LIKE 'ROSTER-%') DESC, updated_at DESC NULLS LAST;

-- 2) Link every device to its member (by name).
UPDATE devices d SET member_id = m.id
  FROM members m WHERE m.name = d.name AND d.member_id IS NULL;

-- 3) Link attendance to members: by device first, then by name for orphan rows
--    (MANUAL-/BULK-/GUEST-/NAME- ids with no devices row).
UPDATE attendance_log a SET member_id = d.member_id
  FROM devices d WHERE a.device_id = d.id AND a.member_id IS NULL;
UPDATE attendance_log a SET member_id = m.id
  FROM members m WHERE a.member_id IS NULL AND a.name = m.name;

-- 4) Migrate ALL admin roles to member_roles, keyed by member — ROSTER-stub grants are
--    KEPT (per maintainer). The role lives on the member, so it survives the device
--    transition: a holder whose member is currently only a ROSTER stub keeps the role,
--    and it becomes usable once they register their own personal device (auth still
--    requires a personal, non-ROSTER device + master password — see auth.ts). Legacy
--    role maps super→super_admin. Tiebreak prefers 'super', then a personal device, if a
--    member somehow has multiple grants.
INSERT INTO member_roles (member_id, role, group_name, subgroup, ministry)
SELECT DISTINCT ON (d.member_id)
  d.member_id,
  CASE e->>'role'
    WHEN 'super' THEN 'super_admin' WHEN 'leader' THEN 'leader'
    WHEN 'pastor' THEN 'pastor' WHEN 'welcoming' THEN 'welcoming'
    ELSE 'super_admin' END,
  COALESCE(e->>'group',''), COALESCE(e->>'subgroup',''), COALESCE(e->>'ministry','')
FROM config c, jsonb_array_elements(c.admin_devices) e
JOIN devices d ON d.id = (e->>'deviceId')
WHERE c.id = 1 AND d.member_id IS NOT NULL
ORDER BY d.member_id,
  (CASE WHEN e->>'role' = 'super' THEN 0 ELSE 1 END),
  (d.id NOT LIKE 'ROSTER-%') DESC
ON CONFLICT (member_id) DO NOTHING;
