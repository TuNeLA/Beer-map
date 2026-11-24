-- 0538 (lane fixB, P-17 + P-01): water / soda are logged but are never a drink; driver mode cannot go ON after a drink.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0538_soft_drinks_driver_rule.sql -f supabase/tests/soft-0538.test.sql
-- Old code proof: -v mig=/dev/null → the script stops at post_soft (function does not exist); with only the old driver_set
-- the "driver ON after a beer" line prints |f|.
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "soft-0538 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-000000000538', 'authenticated', 'authenticated', true);
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-000000000539', 'authenticated', 'authenticated', true);
INSERT INTO public.olnu_server_settings (key, value) VALUES ('drink_cooldown_seconds', '0')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
CREATE TEMP TABLE r (k text, ok boolean, d text);
GRANT ALL ON r TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'no error'; EXCEPTION WHEN others THEN RETURN sqlerrm; END $$;

-- user A: water, soda, then the 20 s rule, a bad kind, and no drink anywhere
SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000538') \g /dev/null
INSERT INTO r SELECT 'post_soft vatten = n 1', (j ->> 'n')::int = 1 AND (j ->> 'vatten')::int = 1, j::text FROM (SELECT public.post_soft('vatten') j) x;
INSERT INTO r SELECT 'a 2nd log within 20 s = slow_down', pg_temp.err('select public.post_soft(''lask'')') ~ 'slow_down', pg_temp.err('select public.post_soft(''lask'')');
UPDATE public.soft_log SET at = at - interval '1 minute' WHERE user_id = '00000000-0000-4000-8000-000000000538';
INSERT INTO r SELECT 'post_soft lask after 20 s', (j ->> 'n')::int = 1 AND (j ->> 'lask')::int = 1 AND (j ->> 'vatten')::int = 1, j::text FROM (SELECT public.post_soft('lask') j) x;
INSERT INTO r SELECT 'other kind = invalid_kind', pg_temp.err('select public.post_soft(''rom'')') ~ 'invalid_kind', pg_temp.err('select public.post_soft(''rom'')');
INSERT INTO r SELECT 'my_soft_tonight = 1 vatten, 1 lask', j = '{"vatten": 1, "lask": 1}'::jsonb, j::text FROM (SELECT public.my_soft_tonight() j) x;
INSERT INTO r SELECT 'water + soda are never a drink (drink_log, beers, ride rule)',
  NOT EXISTS (SELECT 1 FROM public.drink_log d WHERE d.user_id = '00000000-0000-4000-8000-000000000538')
  AND NOT EXISTS (SELECT 1 FROM public.beers b WHERE b.user_id = '00000000-0000-4000-8000-000000000538')
  AND NOT public.olnu_ride_drinking('00000000-0000-4000-8000-000000000538'), '';
INSERT INTO r SELECT 'driver ON with only water + soda = ok', (public.driver_set(true)::jsonb ->> 'on')::boolean, '';
UPDATE public.driver_status SET updated_at = updated_at - interval '5 seconds' WHERE user_id = '00000000-0000-4000-8000-000000000538';
INSERT INTO r SELECT 'driver OFF = ok', (public.driver_set(false)::jsonb ->> 'ok')::boolean, '';

-- user B: one beer → driver ON is refused ('drinking'), OFF is never refused; user B does not see user A's water
SELECT pg_temp.as_user('00000000-0000-4000-8000-000000000539') \g /dev/null
INSERT INTO r SELECT 'user B sees only own numbers', j = '{"vatten": 0, "lask": 0}'::jsonb, j::text FROM (SELECT public.my_soft_tonight() j) x;
SELECT public.post_beer_v2(60.15, 15.19, true, false) \g /dev/null
INSERT INTO r SELECT 'driver ON after a beer = drinking', pg_temp.err('select public.driver_set(true)') ~ 'drinking', pg_temp.err('select public.driver_set(true)');
INSERT INTO r SELECT 'driver ON after a beer: not driving', NOT EXISTS (SELECT 1 FROM public.driver_status d WHERE d.user_id = '00000000-0000-4000-8000-000000000539'
  AND d.night = public.olnu_night_of(now())), '';
INSERT INTO r SELECT 'driver OFF after a beer = ok', (public.driver_set(false)::jsonb ->> 'ok')::boolean, '';
SELECT public.undo_beer() \g /dev/null
UPDATE public.driver_status SET updated_at = updated_at - interval '5 seconds' WHERE user_id = '00000000-0000-4000-8000-000000000539';
INSERT INTO r SELECT 'after Ångra (undo) driver ON = ok', (public.driver_set(true)::jsonb ->> 'on')::boolean, '';

-- grants
INSERT INTO r SELECT 'grants: anon no, authenticated yes, no table access',
  NOT has_function_privilege('anon', 'public.post_soft(text)', 'execute') AND NOT has_function_privilege('anon', 'public.my_soft_tonight()', 'execute')
  AND has_function_privilege('authenticated', 'public.post_soft(text)', 'execute') AND has_function_privilege('authenticated', 'public.driver_set(boolean)', 'execute')
  AND NOT has_function_privilege('anon', 'public.driver_set(boolean)', 'execute')
  AND NOT has_table_privilege('authenticated', 'public.soft_log', 'select') AND NOT has_table_privilege('anon', 'public.soft_log', 'insert'), '';
SELECT k, ok, d FROM r;
SELECT 'soft-0538 done', NOT EXISTS (SELECT 1 FROM r WHERE NOT ok), '';
ROLLBACK;
