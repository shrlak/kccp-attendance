-- One-time cleanup matching the app behavior in supersedeRosterPlaceholders():
-- when a member has both a seeded ROSTER-… placeholder and a real DEV-… device,
-- the real device supersedes the placeholder. For every such name we migrate the
-- placeholder's attendance history and any admin-role grant onto the DEV device,
-- then delete the placeholder so the member has a single canonical device record.
--
-- On a fresh migration-built database no DEV-… devices exist yet, so this is a
-- no-op there; it only consolidates real registrations (e.g. 김호연: ROSTER-25 is
-- absorbed into DEV-B5D13150-…). Idempotent: re-running finds nothing to move.

-- 1) Move attendance history from each placeholder onto its DEV device.
WITH pairs AS (
  SELECT r.id AS roster_id,
         (SELECT d.id FROM devices d WHERE d.name = r.name AND d.id LIKE 'DEV-%' ORDER BY d.id LIMIT 1) AS dev_id
  FROM devices r
  WHERE r.id LIKE 'ROSTER-%'
    AND EXISTS (SELECT 1 FROM devices d WHERE d.name = r.name AND d.id LIKE 'DEV-%')
)
UPDATE attendance_log a SET device_id = p.dev_id
  FROM pairs p WHERE a.device_id = p.roster_id;

-- 2) Move any admin-role grant from a placeholder onto its DEV device, dropping the
--    placeholder entry (and de-duplicating if the DEV device already has its own).
WITH pairs AS (
  SELECT r.id AS roster_id,
         (SELECT d.id FROM devices d WHERE d.name = r.name AND d.id LIKE 'DEV-%' ORDER BY d.id LIMIT 1) AS dev_id
  FROM devices r
  WHERE r.id LIKE 'ROSTER-%'
    AND EXISTS (SELECT 1 FROM devices d WHERE d.name = r.name AND d.id LIKE 'DEV-%')
),
flat AS (
  SELECT e.value AS entry, e.ordinality AS ord
  FROM config c, jsonb_array_elements(c.admin_devices) WITH ORDINALITY AS e(value, ordinality)
  WHERE c.id = 1
),
remapped AS (
  SELECT
    CASE WHEN p.dev_id IS NOT NULL THEN jsonb_set(f.entry, '{deviceId}', to_jsonb(p.dev_id)) ELSE f.entry END AS entry,
    f.ord,
    COALESCE(p.dev_id, f.entry->>'deviceId') AS key,
    (p.dev_id IS NOT NULL) AS was_remapped
  FROM flat f LEFT JOIN pairs p ON p.roster_id = f.entry->>'deviceId'
),
deduped AS (
  SELECT DISTINCT ON (key) entry, ord
  FROM remapped
  ORDER BY key, was_remapped ASC, ord   -- prefer an existing DEV entry over a remapped placeholder
)
UPDATE config SET admin_devices = (SELECT COALESCE(jsonb_agg(entry ORDER BY ord), '[]'::jsonb) FROM deduped)
  WHERE id = 1 AND EXISTS (SELECT 1 FROM pairs);

-- 3) Delete the superseded placeholder device rows.
DELETE FROM devices r
  WHERE r.id LIKE 'ROSTER-%'
    AND EXISTS (SELECT 1 FROM devices d WHERE d.name = r.name AND d.id LIKE 'DEV-%');
