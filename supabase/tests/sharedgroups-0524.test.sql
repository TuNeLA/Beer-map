-- 0524 (lane folkhar): poll_v2 pins of group mates get shared_groups = only the groups that the caller AND that person are in.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0524_shared_groups.sql -f supabase/tests/sharedgroups-0524.test.sql
-- Old code proof: -v mig=/dev/null → the "shared" lines print |f| (no shared_groups key).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "sharedgroups-0524 done|t|".
-- Users: V = the viewer. A = in Alfa524 + Beta524 with V, and in Gamma524 with X (not V). X = in Gamma524 only. S = a stranger.
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000524a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000524a2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000524a3', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000524a4', 'authenticated', 'authenticated', true);
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
-- the pins of one poll_v2 answer around the test bar
CREATE OR REPLACE FUNCTION pg_temp.pins() RETURNS jsonb LANGUAGE sql AS $$
  select coalesce(public.poll_v2(60.10, 15.10, 60.20, 15.30, null, false)::jsonb -> 'pins', '[]'::jsonb);
$$;
CREATE TEMP TABLE r (k text, v text);
SELECT set_config('pn.v', '00000000-0000-4000-8000-0000000524a1', true), set_config('pn.a', '00000000-0000-4000-8000-0000000524a2', true),
       set_config('pn.x', '00000000-0000-4000-8000-0000000524a3', true), set_config('pn.s', '00000000-0000-4000-8000-0000000524a4', true) \g /dev/null
INSERT INTO public.olnu_secrets (id, secret) SELECT 1, 'test-0524-secret' WHERE NOT EXISTS (SELECT 1 FROM public.olnu_secrets WHERE id = 1);
INSERT INTO public.bars_lite (id, name, lat, lng, type, active) VALUES ('t524-bar', 'Bar 524', 60.15000, 15.19000, 'bar', true);

-- groups: A makes Beta524 and Alfa524, V joins both. X makes Gamma524, A joins it.
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'g_beta', (public.create_group('Beta524', 'A524')::jsonb) ->> 'code';
INSERT INTO r SELECT 'g_alfa', (public.create_group('Alfa524', 'A524')::jsonb) ->> 'code';
SELECT pg_temp.as_u(current_setting('pn.x'));
INSERT INTO r SELECT 'g_gamma', (public.create_group('Gamma524', 'X524')::jsonb) ->> 'code';
SELECT pg_temp.as_u(current_setting('pn.v'));
SELECT public.join_group((SELECT v FROM r WHERE k = 'g_beta'), 'V524') IS NOT NULL \g /dev/null
SELECT public.join_group((SELECT v FROM r WHERE k = 'g_alfa'), 'V524') IS NOT NULL \g /dev/null
SELECT pg_temp.as_u(current_setting('pn.a'));
SELECT public.join_group((SELECT v FROM r WHERE k = 'g_gamma'), 'A524') IS NOT NULL \g /dev/null
-- live beers: A and V at the bar
INSERT INTO r SELECT 'beer_a', (public.post_beer_v2(60.15000, 15.19000, true, false)::jsonb) ->> 'id';
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'beer_v', (public.post_beer_v2(60.15000, 15.19000, true, false)::jsonb) ->> 'id';
SELECT 'setup: 3 groups, 2 live beers', (SELECT count(*) FROM public.groups g WHERE g.name IN ('Alfa524', 'Beta524', 'Gamma524')) = 3
   AND (SELECT count(*) FROM r WHERE k IN ('beer_a', 'beer_v') AND v IS NOT NULL) = 2, '';

-- 1. V sees A: shared_groups = Alfa524, Beta524 (sorted by name), with the real group ids. Never Gamma524.
SELECT pg_temp.as_u(current_setting('pn.v'));
INSERT INTO r SELECT 'v_a', (SELECT p::text FROM jsonb_array_elements(pg_temp.pins()) p WHERE p ->> 'friend_name' = 'A524' LIMIT 1);
INSERT INTO r SELECT 'v_names', (SELECT string_agg(g ->> 'name', ',' ORDER BY o) FROM jsonb_array_elements((SELECT v FROM r WHERE k = 'v_a')::jsonb -> 'shared_groups') WITH ORDINALITY x(g, o));
SELECT 'shared: V sees A with Alfa524,Beta524 (sorted)', v = 'Alfa524,Beta524', coalesce(v, 'null') FROM r WHERE k = 'v_names';
SELECT 'shared: the ids are the real group ids',
  (SELECT array_agg((g ->> 'id')::uuid ORDER BY g ->> 'name') FROM jsonb_array_elements((SELECT v FROM r WHERE k = 'v_a')::jsonb -> 'shared_groups') g)
  = (SELECT array_agg(id ORDER BY name) FROM public.groups WHERE name IN ('Alfa524', 'Beta524')), '';
SELECT 'shared: V never gets Gamma524 (a group of A without V)', position('Gamma524' in pg_temp.pins()::text) = 0, '';
INSERT INTO r SELECT 'v_own', (SELECT p::text FROM jsonb_array_elements(pg_temp.pins()) p WHERE (p ->> 'is_mine')::boolean LIMIT 1);
SELECT 'own pin: no shared_groups key', v IS NOT NULL AND NOT (v::jsonb ? 'shared_groups'), coalesce(left(v, 80), 'null') FROM r WHERE k = 'v_own';

-- 2. X sees A: only Gamma524
SELECT pg_temp.as_u(current_setting('pn.x'));
INSERT INTO r SELECT 'x_names', (SELECT string_agg(g ->> 'name', ',') FROM jsonb_array_elements(
  (SELECT p -> 'shared_groups' FROM jsonb_array_elements(pg_temp.pins()) p WHERE p ->> 'friend_name' = 'A524' LIMIT 1)) g);
SELECT 'shared: X sees A with Gamma524 only', v = 'Gamma524', coalesce(v, 'null') FROM r WHERE k = 'x_names';
SELECT 'shared: X never gets Alfa524 / Beta524', position('Alfa524' in pg_temp.pins()::text) = 0 AND position('Beta524' in pg_temp.pins()::text) = 0, '';

-- 3. the stranger S: sees the pins, no shared_groups key, no group name, no name
SELECT pg_temp.as_u(current_setting('pn.s'));
INSERT INTO r SELECT 's_n', jsonb_array_length(pg_temp.pins())::text;
SELECT 'stranger: S sees the pins at the bar', v::int >= 1, v FROM r WHERE k = 's_n';
SELECT 'stranger: no shared_groups key on any pin', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.pins()) p WHERE p ? 'shared_groups'), '';
SELECT 'stranger: no group name and no friend name in the answer', pg_temp.pins()::text !~ '(Alfa|Beta|Gamma)524|A524|V524', '';

-- 4. the helper is internal, and the patch is in poll_v2
SELECT 'helper: anon cannot run olnu_s524_shared', CASE WHEN to_regprocedure('public.olnu_s524_shared(uuid, bigint)') IS NULL THEN false ELSE NOT has_function_privilege('anon', 'public.olnu_s524_shared(uuid, bigint)', 'execute') END, '';
SELECT 'helper: authenticated cannot run olnu_s524_shared', CASE WHEN to_regprocedure('public.olnu_s524_shared(uuid, bigint)') IS NULL THEN false ELSE NOT has_function_privilege('authenticated', 'public.olnu_s524_shared(uuid, bigint)', 'execute') END, '';
SELECT 'shared: poll_v2 has the marker once',
  (length(pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure))
   - length(replace(pg_get_functiondef('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)'::regprocedure), '/*sg524*/', ''))) = 9, '';
SELECT 'sharedgroups-0524 done', true, '';
ROLLBACK;
