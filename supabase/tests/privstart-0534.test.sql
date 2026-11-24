-- 0534 (lane texts, B3/B8): a NEW auth.users row starts as friends_only = true; an existing account is not changed.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0534_new_user_privacy.sql -f supabase/tests/privstart-0534.test.sql
-- Old code proof: -v mig=/dev/null → the "new account" line prints |f| (no row, my_visibility = false).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "privstart-0534 done|t|".
\pset format unaligned
\pset tuples_only on
BEGIN;
-- an account that exists BEFORE the migration (no visibility row = Alla) and one that picked Alla on purpose.
-- In CI the release rehearsal has already run 0534 on rh_lf: replica mode turns the trigger off for these two inserts,
-- so they stand for accounts made before 0534 went live.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-0000000534a1', 'authenticated', 'authenticated', true);
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-0000000534a2', 'authenticated', 'authenticated', true);
INSERT INTO public.olnu_visibility (user_id, friends_only) VALUES ('00000000-0000-4000-8000-0000000534a2', false) ON CONFLICT (user_id) DO UPDATE SET friends_only = false;
SET LOCAL session_replication_role = origin;
\i :mig
\i :mig
-- a NEW account after the migration
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES ('00000000-0000-4000-8000-0000000534b1', 'authenticated', 'authenticated', true);
CREATE TEMP TABLE r (k text, v text);
CREATE OR REPLACE FUNCTION pg_temp.vis(p uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p::text, true);
  SELECT (public.my_visibility()::jsonb ->> 'friends_only') INTO r;
  RETURN r;
END $$;
INSERT INTO r SELECT 'new', pg_temp.vis('00000000-0000-4000-8000-0000000534b1');
INSERT INTO r SELECT 'old', pg_temp.vis('00000000-0000-4000-8000-0000000534a1');
INSERT INTO r SELECT 'alla', pg_temp.vis('00000000-0000-4000-8000-0000000534a2');
SELECT 'new account: my_visibility friends_only = true', v = 'true', v FROM r WHERE k = 'new';
SELECT 'existing account with no row: still false (Alla)', v = 'false', v FROM r WHERE k = 'old';
SELECT 'existing account that picked Alla: still false', v = 'false', v FROM r WHERE k = 'alla';
SELECT 'existing account with no row: still no row', NOT EXISTS (SELECT 1 FROM public.olnu_visibility WHERE user_id = '00000000-0000-4000-8000-0000000534a1'), '' ;
-- the person can still change it (set_visibility, 0340)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000534b1","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000534b1', true) \g /dev/null
SELECT public.set_visibility(false) \g /dev/null
INSERT INTO r SELECT 'changed', (public.my_visibility()::jsonb ->> 'friends_only');
SELECT 'new account can switch to Alla', v = 'false', v FROM r WHERE k = 'changed';
-- grants: nobody may call the trigger function as an RPC
SELECT 'execute revoked from anon and authenticated',
  NOT has_function_privilege('anon', 'public.olnu_new_user_privacy()', 'execute') AND NOT has_function_privilege('authenticated', 'public.olnu_new_user_privacy()', 'execute'), '';
SELECT 'one trigger on auth.users', (SELECT count(*) FROM pg_trigger WHERE tgname = 'olnu_new_user_privacy' AND tgrelid = 'auth.users'::regclass) = 1, '';
SELECT 'privstart-0534 done', true, '';
ROLLBACK;
