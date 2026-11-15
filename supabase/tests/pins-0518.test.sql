-- 0518 (lane srv1): the old pin functions give a stranger no fixed beer id; skal / react check block and visibility.
-- LOCAL / CI copy only (rh_lf). One transaction, ROLLBACK at the end. Runs the migration twice (idempotent).
-- usage:
--   psql -d rh_lf -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0518_old_pin_ids.sql -f supabase/tests/pins-0518.test.sql
-- Old code proof: -v mig=/dev/null → the "stranger" lines print |f| (real id in live_beers, skal on any beer id).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "pins-0518 done|t|".
-- Users: A has a live beer at a bar, B is a stranger, M is A's group mate.
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000518a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000518a2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000518a3', 'authenticated', 'authenticated', true);
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE p_sql INTO r;
  RETURN coalesce(r, 'null');
EXCEPTION WHEN others THEN
  RETURN 'ERR:' || sqlerrm;
END $$;
CREATE TEMP TABLE r (k text, v text);
SELECT set_config('pn.a', '00000000-0000-4000-8000-0000000518a1', true), set_config('pn.b', '00000000-0000-4000-8000-0000000518a2', true),
       set_config('pn.m', '00000000-0000-4000-8000-0000000518a3', true) \g /dev/null
INSERT INTO public.olnu_secrets (id, secret) SELECT 1, 'test-0518-secret' WHERE NOT EXISTS (SELECT 1 FROM public.olnu_secrets WHERE id = 1);
INSERT INTO public.bars_lite (id, name, lat, lng, type, active) VALUES ('t518-bar', 'Bar 518', 60.15000, 15.19000, 'bar', true);

SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'grp', (public.create_group('Grp518', 'A518')::jsonb) ->> 'code';
INSERT INTO r SELECT 'beer', (public.post_beer_v2(60.15000, 15.19000, true, false)::jsonb) ->> 'id';
INSERT INTO r SELECT 'other', pg_temp.try($q$select public.post_other_v2('vin', 60.15000, 15.19000, true)::text$q$);
SELECT pg_temp.as_u(current_setting('pn.m'));
SELECT public.join_group((SELECT v FROM r WHERE k = 'grp'), 'M518') IS NOT NULL \g /dev/null

-- 1. the stranger B: live_beers has A's pin, but not A's beer id
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'b_rows', count(*)::text FROM public.live_beers() l WHERE NOT l.is_mine;
INSERT INTO r SELECT 'b_real', count(*)::text FROM public.live_beers() l WHERE l.id = (SELECT v::bigint FROM r WHERE k = 'beer');
INSERT INTO r SELECT 'b_neg', (SELECT l.id::text FROM public.live_beers() l WHERE NOT l.is_mine AND l.id < 0 LIMIT 1);
SELECT 'stranger: live_beers shows the pin', v = '1', v FROM r WHERE k = 'b_rows';
SELECT 'stranger: live_beers does not give the real beer id', v = '0', v FROM r WHERE k = 'b_real';
SELECT 'stranger: the id is a negative rotating number', v IS NOT NULL, coalesce(v, 'null') FROM r WHERE k = 'b_neg';
INSERT INTO r SELECT 'b_others', count(*)::text FROM public.live_others();
INSERT INTO r SELECT 'b_rx', count(*)::text FROM public.beer_reactions();
SELECT 'stranger: live_others has no row of A', v = '0', v FROM r WHERE k = 'b_others';

-- 2. skal / react with the real id: refused. With the rotating number or the poll_v2 pin: works.
INSERT INTO r SELECT 'b_skal_real', pg_temp.try(format($q$select public.skal(%s)::text$q$, (SELECT v FROM r WHERE k = 'beer')));
INSERT INTO r SELECT 'b_react_real', pg_temp.try(format($q$select public.react(%s, '🔥')::text$q$, (SELECT v FROM r WHERE k = 'beer')));
SELECT 'stranger: skal(real id) says beer_not_found', v ~ 'beer_not_found', v FROM r WHERE k = 'b_skal_real';
SELECT 'stranger: react(real id) says beer_not_found', v ~ 'beer_not_found', v FROM r WHERE k = 'b_react_real';
INSERT INTO r SELECT 'b_skal_neg', pg_temp.try(format($q$select public.skal(%s)::text$q$, (SELECT v FROM r WHERE k = 'b_neg')));
SELECT 'stranger: skal(rotating number) works', v ~ '"skal_count" : 1', v FROM r WHERE k = 'b_skal_neg';
INSERT INTO r SELECT 'b_pin', (SELECT p ->> 'id' FROM jsonb_array_elements(public.poll_v2(60.0, 15.0, 60.3, 15.4, null, false)::jsonb -> 'pins') p WHERE p ->> 'id' ~ '^p' LIMIT 1);
INSERT INTO r SELECT 'b_skal_pin', pg_temp.try(format($q$select public.skal_v2(%L)::text$q$, (SELECT v FROM r WHERE k = 'b_pin')));
SELECT 'stranger: skal_v2(pin id) works as before (already true)', v ~ '"already" : true', v FROM r WHERE k = 'b_skal_pin';
INSERT INTO r SELECT 'b_react_pin', pg_temp.try(format($q$select public.react_v2(%L, '💪')::text$q$, (SELECT v FROM r WHERE k = 'b_pin')));
SELECT 'stranger: react_v2(pin id) works as before', v ~ '💪', v FROM r WHERE k = 'b_react_pin';
INSERT INTO r SELECT 'b_react_neg', pg_temp.try(format($q$select public.react(%s, '🔥')::text$q$, (SELECT v FROM r WHERE k = 'b_neg')));
SELECT 'stranger: react(rotating number) works', v ~ '🔥', v FROM r WHERE k = 'b_react_neg';

-- 3. the group mate M and the owner A: as before
SELECT pg_temp.as_u(current_setting('pn.m'));
INSERT INTO r SELECT 'm_skal', pg_temp.try(format($q$select public.skal(%s)::text$q$, (SELECT v FROM r WHERE k = 'beer')));
SELECT 'mate: skal(real id) works', v ~ '"skal_count" : 2', v FROM r WHERE k = 'm_skal';
INSERT INTO r SELECT 'm_real', count(*)::text FROM public.live_beers() l WHERE l.id = (SELECT v::bigint FROM r WHERE k = 'beer');
INSERT INTO r SELECT 'm_others', count(*)::text FROM public.live_others();
INSERT INTO r SELECT 'm_rx', count(*)::text FROM public.beer_reactions();
SELECT 'mate: live_beers gives the real id, live_others and beer_reactions have rows', (SELECT v FROM r WHERE k = 'm_real') = '1' AND (SELECT v FROM r WHERE k = 'm_others') = '1' AND (SELECT v::int FROM r WHERE k = 'm_rx') >= 1, '';
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'a_skal', pg_temp.try(format($q$select public.skal(%s)::text$q$, (SELECT v FROM r WHERE k = 'beer')));
SELECT 'owner: skal on the own beer says own_beer', v ~ 'own_beer', v FROM r WHERE k = 'a_skal';

-- 4. "Bara vänner": the stranger cannot skål any more, also not with a pin id he got before
INSERT INTO r SELECT 'vis', pg_temp.try($q$select public.set_visibility(true)::text$q$);
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'b_fo', pg_temp.try(format($q$select public.react_v2(%L, '😂')::text$q$, (SELECT v FROM r WHERE k = 'b_pin')));
SELECT 'friends only: react_v2 with an old pin id says beer_not_found', v ~ 'beer_not_found', v FROM r WHERE k = 'b_fo';
SELECT pg_temp.as_u(current_setting('pn.a'));
INSERT INTO r SELECT 'vis2', pg_temp.try($q$select public.set_visibility(false)::text$q$);

-- 5. a block (either way): beer_not_found
INSERT INTO public.user_blocks (blocker, blocked) VALUES (current_setting('pn.a')::uuid, current_setting('pn.b')::uuid);
SELECT pg_temp.as_u(current_setting('pn.b'));
INSERT INTO r SELECT 'b_blk', pg_temp.try(format($q$select public.react_v2(%L, '😂')::text$q$, (SELECT v FROM r WHERE k = 'b_pin')));
SELECT 'block: react_v2 with an old pin id says beer_not_found', v ~ 'beer_not_found', v FROM r WHERE k = 'b_blk';
SELECT 'pins-0518 done', true, '';
ROLLBACK;
