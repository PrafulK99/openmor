-- Lock the app's tables away from Supabase's Data API (PostgREST/GraphQL).
--
-- The app connects as the table owner (postgres), which bypasses RLS, so this
-- does not affect Prisma. RLS is enabled with NO policies, which denies every
-- row to any other role. Supabase's auto-RLS may already have done this; the
-- statements are idempotent and keep the guarantee in the repo regardless of
-- project settings.
--
-- REVOKE matters on top of RLS: RLS does not cover TRUNCATE, and Supabase's
-- default privileges grant anon/authenticated full access to new tables.

ALTER TABLE "Merchant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BuyerLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSession" ENABLE ROW LEVEL SECURITY;
-- Absent when Prisma replays migrations into a shadow database.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- anon/authenticated exist only on Supabase; skip cleanly on plain Postgres.
DO $$
DECLARE
  api_role text;
  tbl text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH tbl IN ARRAY ARRAY['Merchant', 'Product', 'Quote', 'Order', 'BuyerLink', 'AgentSession', '_prisma_migrations'] LOOP
        IF to_regclass(format('public.%I', tbl)) IS NOT NULL THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, api_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;
