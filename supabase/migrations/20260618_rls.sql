-- Row-Level Security (spec D1 / plan Phase D1).
--
-- ⚠️ APPLY ONLY DURING THE COORDINATED CUTOVER (plan Phase F). Enabling RLS while the
-- legacy app is still live breaks it: the legacy client reads the roster via the
-- (unauthenticated) edge function, and the world-readable `/api/data` path depends on
-- no row filtering. RLS + the hardened function + the React deploy flip together.
--
-- Model: deny-all for anon/authenticated (no policy = no access); the edge function
-- uses the service-role key and BYPASSES RLS, so it stays the enforcement point.
-- The scoped SELECT policies below are defense-in-depth: if a client ever queries
-- PostgREST directly with a user JWT, it still only sees its allowed rows.

ALTER TABLE members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE config                ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_invites         ENABLE ROW LEVEL SECURITY;

-- ── Defense-in-depth scoped reads (authenticated staff only) ───────────────
CREATE POLICY members_super_read ON members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role IN ('super_admin','pastor')
  ));

CREATE POLICY members_leader_read ON members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff s
    WHERE s.user_id = auth.uid() AND s.role = 'leader'
      AND s.group_name = members.group_name
      AND (s.subgroup = '' OR s.subgroup = members.subgroup)
  ));

CREATE POLICY attlog_scoped_read ON attendance_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM members m
    WHERE m.id = attendance_log.member_id AND (
      EXISTS (SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role IN ('super_admin','pastor'))
      OR EXISTS (
        SELECT 1 FROM staff s WHERE s.user_id = auth.uid() AND s.role = 'leader'
          AND s.group_name = m.group_name AND (s.subgroup = '' OR s.subgroup = m.subgroup)
      )
    )
  ));

-- A staff member can read their own row.
CREATE POLICY staff_self_read ON staff FOR SELECT TO authenticated
  USING (user_id = auth.uid());
