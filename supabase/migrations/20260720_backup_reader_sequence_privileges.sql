-- pg_dump --data-only includes sequence values. The read-only backup role therefore
-- needs SELECT on sequences as well as tables; SELECT permits reading last_value but
-- does not permit nextval(), so the role remains unable to advance or modify them.
--
-- Preview/verification databases intentionally do not create this production-only
-- login. Guard the grants so the full migration chain remains self-contained there.
DO $$
BEGIN
    IF to_regrole('backup_reader') IS NULL THEN
        RAISE NOTICE 'backup_reader does not exist; skipping backup sequence grants';
        RETURN;
    END IF;

    EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup_reader';

    -- Migrations create public objects as postgres. Keep later BIGSERIAL/IDENTITY
    -- sequences readable by the backup role without broadening table write access.
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
         || 'GRANT SELECT ON SEQUENCES TO backup_reader';
END
$$;
