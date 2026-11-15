-- 0521 (lane srv1): claim_medal and award_medals('home') need a server fact; claims are counted in medal_claim_log.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0521_medal_claims.sql -f supabase/tests/medals-0521.test.sql
-- Old code proof: -v mig=/dev/null → the "new account" lines print |f| (medals for nothing).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "medals-0521 done|t|".
-- Users: N = a new account (today), O = an account from before the server medals (1 Oct 2026).
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous, created_at) VALUES
  ('00000000-0000-4000-8000-0000000521a1', 'authenticated', 'authenticated', true, now()),
  ('00000000-0000-4000-8000-0000000521a2', 'authenticated', 'authenticated', true, timestamptz '2026-10-01 12:00:00+00');
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
-- the medals a call gives (new or raised), or the error text
CREATE OR REPLACE FUNCTION pg_temp.got(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE 'select coalesce(string_agg(x.medal, '','' order by x.medal), '''') from (' || p_sql || ') x' INTO r;
  RETURN r;
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
CREATE TEMP TABLE r (k text, v text);
SELECT set_config('pn.n', '00000000-0000-4000-8000-0000000521a1', true), set_config('pn.o', '00000000-0000-4000-8000-0000000521a2', true) \g /dev/null

-- 1. a new account with one live drink: no medal for a claim, no hemvärn for award_medals('home')
SELECT pg_temp.as_u(current_setting('pn.n'));
SELECT (public.post_beer_v2(60.15, 15.19, false, false)::jsonb ->> 'accepted') \g /dev/null
INSERT INTO r SELECT 'n_base', pg_temp.got($q$select * from public.award_medals(null)$q$);
INSERT INTO r SELECT 'n_krog', pg_temp.got($q$select * from public.claim_medal('krogrunda')$q$);
INSERT INTO r SELECT 'n_vat', pg_temp.got($q$select * from public.claim_medal('vatten')$q$);
INSERT INTO r SELECT 'n_spoke', pg_temp.got($q$select * from public.claim_medal('spoke')$q$);
INSERT INTO r SELECT 'n_home', pg_temp.got($q$select * from public.award_medals('home')$q$);
SELECT 'new account: claim_medal(krogrunda) gives nothing', v = '', v FROM r WHERE k = 'n_krog';
SELECT 'new account: claim_medal(vatten) with no water gives nothing', v = '', v FROM r WHERE k = 'n_vat';
SELECT 'new account: claim_medal(spoke) with no ghost drink gives nothing', v = '', v FROM r WHERE k = 'n_spoke';
SELECT 'new account: award_medals(home) with no home fact gives no hemvarn', v !~ 'hemvarn', v FROM r WHERE k = 'n_home';
SELECT 'new account: no claim row was stored', count(*) = 0, count(*)::text FROM public.medal_claims WHERE user_id = current_setting('pn.n')::uuid;
SELECT 'log: 3 rows, all refused', count(*) = 3 AND sum(refused) = 3 AND sum(tries) = 3, string_agg(medal || ':' || last_why, ',' ORDER BY medal)
  FROM public.medal_claim_log WHERE user_id = current_setting('pn.n')::uuid;

-- 2. the real flows still give the medals
INSERT INTO r SELECT 'water', public.game_water()::text;
INSERT INTO r SELECT 'n_vat2', pg_temp.got($q$select * from public.claim_medal('vatten')$q$);
SELECT 'real flow: water in the game, then claim_medal(vatten) gives vatten', v ~ 'vatten', v FROM r WHERE k = 'n_vat2';
SELECT public.stop_beer() \g /dev/null
INSERT INTO r SELECT 'n_home2', pg_temp.got($q$select * from public.award_medals('home')$q$);
SELECT 'real flow: the home tap (stop_beer), then award_medals(home) gives hemvarn', v ~ 'hemvarn', v FROM r WHERE k = 'n_home2';
INSERT INTO r SELECT 'bad', pg_temp.got($q$select * from public.claim_medal('nope')$q$);
SELECT 'an unknown medal name is still invalid_medal', v ~ 'invalid_medal', v FROM r WHERE k = 'bad';

-- 3. an account from before the server medals: the one-time move of an old local badge still works, one time
SELECT pg_temp.as_u(current_setting('pn.o'));
INSERT INTO r SELECT 'o_krog', pg_temp.got($q$select * from public.claim_medal('krogrunda')$q$);
INSERT INTO r SELECT 'o_krog2', pg_temp.got($q$select * from public.claim_medal('krogrunda')$q$);
SELECT 'old account: claim_medal(krogrunda) gives the old badge', v ~ 'krogrunda', v FROM r WHERE k = 'o_krog';
SELECT 'old account: the second claim gives nothing more', v = '', v FROM r WHERE k = 'o_krog2';
SELECT 'old account: one claim row', count(*) = 1, count(*)::text FROM public.medal_claims WHERE user_id = current_setting('pn.o')::uuid;

-- 4. more than 30 calls for one medal in one day: nothing happens, no rows
UPDATE public.medal_claim_log SET day_tries = 30 WHERE user_id = current_setting('pn.o')::uuid AND medal = 'krogrunda';
INSERT INTO r SELECT 'o_31', pg_temp.got($q$select * from public.claim_medal('krogrunda')$q$);
SELECT 'limit: call 31 of the day returns no rows and no error', v = '', v FROM r WHERE k = 'o_31';
SELECT 'medals-0521 done', true, '';
ROLLBACK;
