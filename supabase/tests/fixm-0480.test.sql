-- 0480 (lane fixM, T-15): rpc_bundle2 takes zone_counts. LOCAL / staging copy only. One transaction, ROLLBACK at the end.
-- Runs 0480 itself twice (2nd = skip). Needs: the schema (+ 0221 zone_counts, 0297 rpc_bundle2).
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0480_fixm_zone_counts_bundle.sql -f supabase/tests/fixm-0480.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role) VALUES ('00000000-0000-4000-8000-000000048001', 'authenticated', 'authenticated');
CREATE OR REPLACE FUNCTION pg_temp.as_me() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000048001","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000048001', true);
END $$;
SELECT pg_temp.as_me();
-- before: zone_counts is not on the list
SELECT 'before: zone_counts not_bundled', (public.rpc_bundle2('[{"k":"z","n":"zone_counts","a":{}},{"k":"s","n":"my_status","a":{}}]'::jsonb) -> 'z' -> 'e' ->> 'message') = 'not_bundled', '';
\i :mig
\i :mig
SELECT 'marker fixm0480', position('fixm0480' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
SELECT pg_temp.as_me();
WITH r AS (SELECT public.rpc_bundle2('[{"k":"z","n":"zone_counts","a":{}},{"k":"s","n":"my_status","a":{}}]'::jsonb) AS j)
SELECT 'after: zone_counts answered in the bundle', (j -> 'z' ? 'd') AND jsonb_typeof(j -> 'z' -> 'd' -> 'kommun') = 'array', left((j -> 'z')::text, 120) FROM r
UNION ALL
SELECT 'after: my_status still answered', (j -> 's' ? 'd'), left((j -> 's')::text, 80) FROM r;
SELECT 'old names still on the list', position('''golden_horse''' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0
   AND position('''game_poll''' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
ROLLBACK;
