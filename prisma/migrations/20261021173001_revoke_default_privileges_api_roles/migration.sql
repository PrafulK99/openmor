-- Stop new objects from being exposed to Supabase's Data API by default.
--
-- Supabase sets default privileges so that anything the postgres role creates
-- in public is granted to anon/authenticated. Migrations run as postgres, so
-- every future table would start out readable and writable through the API
-- until revoked. This removes those defaults for tables, sequences and
-- functions; new objects then need explicit grants if they should be exposed.
--
-- Only postgres's defaults are changed. supabase_admin's defaults cannot be
-- altered by postgres and do not apply to objects our migrations create.

DO $$
DECLARE
  api_role text;
BEGIN
  -- anon/authenticated exist only on Supabase; skip cleanly on plain Postgres.
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
