-- 0509 (lane bump): Skåla med telefonen matcher. LOCAL / staging copy only. One transaction, ROLLBACK at the end.
-- Runs 0509 twice (idempotent). usage:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0509_bump_cheers.sql -f supabase/tests/bump-0509.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail. Takes ~15 s (pg_sleep for the 2 s rate limit and the 1.5 s window).
\pset format unaligned
\pset tuples_only on
BEGIN;
SELECT 'before: bump_ready missing (FAILS on the old code)', to_regprocedure('public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)') IS NULL, '';
\i :mig
\i :mig
-- users: A–B friends, A–C strangers, A–D friends but A blocked D, A–E friends far away, F–G one group (no friendship)
INSERT INTO auth.users (id, aud, role) SELECT ('00000000-0000-4000-8000-0000000509' || n)::uuid, 'authenticated', 'authenticated'
  FROM unnest(array['0a', '0b', '0c', '0d', '0e', '0f', '1a']) n ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-0000000509' || p)::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || pg_temp.u(p) || '","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', pg_temp.u(p)::text, true);
END $$;
INSERT INTO public.friendships (a, b, requester, status, accepted_at)
SELECT least(pg_temp.u('0a'), pg_temp.u(x)), greatest(pg_temp.u('0a'), pg_temp.u(x)), pg_temp.u('0a'), 'accepted', now() FROM unnest(array['0b', '0d', '0e']) x;
INSERT INTO public.dm_blocks (blocker, blocked) VALUES (pg_temp.u('0a'), pg_temp.u('0d'));
INSERT INTO public.groups (id, name, code) VALUES ('00000000-0000-4000-8000-000000050999', 'Bumpgänget', 'BMPXYZ');
INSERT INTO public.group_members (group_id, user_id, display_name) VALUES
  ('00000000-0000-4000-8000-000000050999', pg_temp.u('0f'), 'Fia'), ('00000000-0000-4000-8000-000000050999', pg_temp.u('1a'), 'Gus');
CREATE TEMP TABLE r (k text PRIMARY KEY, j jsonb);
GRANT ALL ON r TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.b(who text, k text, lat float8, lng float8, ago int DEFAULT 0, kind text DEFAULT 'bump', hid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_u(who);
  BEGIN
    v := public.bump_ready(lat, lng, ago, 10, true, hid, kind);
  EXCEPTION WHEN others THEN v := jsonb_build_object('err', sqlerrm);
  END;
  INSERT INTO r VALUES (k, v) ON CONFLICT ON CONSTRAINT r_pkey DO UPDATE SET j = excluded.j;
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.w(who text, k text, id bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_u(who); v := public.bump_wait(id);
  INSERT INTO r VALUES (k, v) ON CONFLICT ON CONSTRAINT r_pkey DO UPDATE SET j = excluded.j; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.beers(who text) RETURNS int LANGUAGE sql AS $$
  SELECT coalesce((SELECT b.beer_count FROM public.beers b WHERE b.user_id = pg_temp.u(who)), 0) $$;

-- 1. flag OFF (default) = feature_off
SELECT 'flag row added, default off', (SELECT NOT on_ FROM public.bold_flags WHERE key = 'pn_bump'), '';
SELECT 'flag off: feature_off', pg_temp.b('0a', 'off', 60.15, 15.18) ->> 'err' = 'feature_off', (SELECT j::text FROM r WHERE k = 'off');
UPDATE public.bold_flags SET on_ = true WHERE key = 'pn_bump';
-- 2. A knocks, a stranger C knocks at the same spot, then friend B 20 m away
SELECT 'A alone: no pair yet', (pg_temp.b('0a', 'a1', 60.15, 15.18) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'a1');
SELECT 'stranger C: no match', (pg_temp.b('0c', 'c1', 60.15, 15.18) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'c1');
SELECT 'friend B 20 m: match with A', (pg_temp.b('0b', 'b1', 60.15018, 15.18) ->> 'pair')::bigint = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1'),
  (SELECT j::text FROM r WHERE k = 'b1');
SELECT 'B: beer logged by post_beer_v2 (accepted)', (SELECT (j -> 'beer' ->> 'accepted')::boolean FROM r WHERE k = 'b1') AND pg_temp.beers('0b') = 1, pg_temp.beers('0b')::text;
SELECT 'B sees only a name (no position of A)', (SELECT j -> 'matched' = '[{"name": "Kompis"}]'::jsonb FROM r WHERE k = 'b1'),
  (SELECT (j -> 'matched')::text FROM r WHERE k = 'b1');
SELECT 'A wait: matched, beer accepted', (pg_temp.w('0a', 'a1w', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1')) -> 'beer' ->> 'accepted')::boolean, (SELECT j::text FROM r WHERE k = 'a1w');
SELECT 'A: 1 beer logged', pg_temp.beers('0a') = 1, pg_temp.beers('0a')::text;
SELECT 'A wait again: same pair', (pg_temp.w('0a', 'a1w2', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1')) ->> 'pair') IS NOT NULL, '';
SELECT 'A wait again: no second beer', pg_temp.beers('0a') = 1, pg_temp.beers('0a')::text;
SELECT 'C wait: still alone', (pg_temp.w('0c', 'c1w', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'c1')) ->> 'pair') IS NULL, '';
SELECT 'C: no beer', pg_temp.beers('0c') = 0, '';
-- 3. rate limit: 1 bump per 2 s
SELECT 'A again at once: slow_down', pg_temp.b('0a', 'a2', 60.15, 15.18) ->> 'err' = 'slow_down', (SELECT j::text FROM r WHERE k = 'a2');
SELECT pg_sleep(3.2);
-- 4. blocked friend D: no match. Friend E in Stockholm: no match.
SELECT 'A + blocked D: no match', (pg_temp.b('0a', 'a3', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0d', 'd3', 60.15, 15.18) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'd3');
SELECT pg_sleep(3.2);
SELECT 'A + friend E 80 m away: no match (50 m rule)', (pg_temp.b('0a', 'a4', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0e', 'e4', 60.15072, 15.18) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'e4');
SELECT pg_sleep(3.2);
SELECT 'A + friend E 400 km away: no match', (pg_temp.b('0a', 'a4b', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0e', 'e4b', 59.33, 18.06) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'e4b');
SELECT pg_sleep(3.2);
-- 5. time window: knock 1.7 s apart = no match; tap fallback 1.7 s apart = match
SELECT 'knock 1.7 s apart: no match', (pg_temp.b('0a', 'a5', 60.15, 15.18) ->> 'pair') IS NULL, '';
SELECT pg_sleep(1.7);
SELECT 'knock 1.7 s apart: no match (B)', (pg_temp.b('0b', 'b5', 60.15, 15.18) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'b5');
SELECT pg_sleep(0.4);
SELECT 'E: p_ago_ms 1000 puts the knock 1.1 s after A = match with A', (pg_temp.b('0e', 'e5', 60.1501, 15.18, 1000) ->> 'pair')::bigint = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a5'),
  (SELECT j::text FROM r WHERE k = 'e5');
SELECT pg_sleep(3.2);
SELECT 'tap A', (pg_temp.b('0a', 'a6', 60.15, 15.18, 0, 'tap') ->> 'pair') IS NULL, '';
SELECT pg_sleep(1.7);
SELECT 'tap B 1.7 s later: match (3 s window)', (pg_temp.b('0b', 'b6', 60.15, 15.18, 0, 'tap') ->> 'pair')::bigint = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a6'), (SELECT j::text FROM r WHERE k = 'b6');
-- 6. same limits as ÖL!: B had a beer 10 s ago → the 10-min rule refuses this one; no extra beer
SELECT 'same limits: B beer refused (cooldown), still 1 beer', (SELECT (j -> 'beer' ->> 'accepted')::boolean = false AND (j -> 'beer' ->> 'wait_seconds')::int > 500 FROM r WHERE k = 'b6') AND pg_temp.beers('0b') = 1,
  (SELECT (j -> 'beer')::text FROM r WHERE k = 'b6');
SELECT 'same limits: A beer refused too', (pg_temp.w('0a', 'a6w', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a6')) -> 'beer' ->> 'accepted')::boolean = false, (SELECT (j -> 'beer')::text FROM r WHERE k = 'a6w');
SELECT 'same limits: A still 1 beer', pg_temp.beers('0a') = 1, pg_temp.beers('0a')::text;
-- 7. group members (no friendship), same checked-in bar, no GPS; spökläge = hidden beer
INSERT INTO public.checkins (user_id, bar_id, bar_name, lat, lng) VALUES
  (pg_temp.u('0f'), 'osm-n-509', 'Bumpbaren', 60.1499, 15.1801), (pg_temp.u('1a'), 'osm-n-509', 'Bumpbaren', 60.1499, 15.1801);
SELECT 'group F, no GPS, at the bar', (pg_temp.b('0f', 'f7', NULL, NULL, 0, 'bump', true) ->> 'pair') IS NULL, (SELECT j::text FROM r WHERE k = 'f7');
SELECT 'group G, no GPS, same bar: match', (pg_temp.b('1a', 'g7', NULL, NULL) ->> 'pair')::bigint = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'f7'), (SELECT j::text FROM r WHERE k = 'g7');
SELECT 'G sees the group name Fia', (SELECT j -> 'matched' -> 0 ->> 'name' = 'Fia' FROM r WHERE k = 'g7'), '';
SELECT 'F spökläge: beer hidden', (pg_temp.w('0f', 'f7w', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'f7')) -> 'beer' ->> 'hidden')::boolean, (SELECT (j -> 'beer')::text FROM r WHERE k = 'f7w');
SELECT 'F spökläge: no pin (stopped + ghost)', (SELECT stopped AND ghost FROM public.beers WHERE user_id = pg_temp.u('0f')), '';
SELECT 'G: beer at the bar, visible', (SELECT (j -> 'beer' ->> 'accepted')::boolean AND NOT (j -> 'beer' ->> 'hidden')::boolean FROM r WHERE k = 'g7'), (SELECT (j -> 'beer')::text FROM r WHERE k = 'g7');
-- 8. privacy: positions are cleared after 10 min (at the next bump anywhere)
UPDATE public.pn_bumps SET at = at - interval '11 minutes' WHERE user_id = pg_temp.u('0c');
SELECT pg_sleep(2.1);
SELECT 'a new bump', (pg_temp.b('0e', 'e8', 60.15, 15.18) ->> 'id') IS NOT NULL, '';
SELECT 'old positions set to null', NOT EXISTS (SELECT 1 FROM public.pn_bumps WHERE user_id = pg_temp.u('0c') AND lat IS NOT NULL), '';
SELECT 'new positions kept', EXISTS (SELECT 1 FROM public.pn_bumps WHERE user_id = pg_temp.u('0e') AND lat IS NOT NULL), '';
-- 9. grants + CR + bad input
SELECT 'anon cannot call bump_ready / bump_wait', NOT has_function_privilege('anon', 'public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.bump_wait(bigint)', 'execute'), '';
SELECT 'authenticated: bump_ready yes, olnu_bump_post no', has_function_privilege('authenticated', 'public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.olnu_bump_post(bigint)', 'execute'), '';
SELECT 'bad kind / half position refused', pg_temp.b('0b', 'x1', 60.15, 15.18, 0, 'shot') ->> 'err' = 'invalid_kind' AND pg_temp.b('0b', 'x2', 60.15, NULL) ->> 'err' = 'invalid_pos', '';
CREATE OR REPLACE FUNCTION pg_temp.try_wait(who text, id bigint) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.as_u(who); PERFORM public.bump_wait(id); RETURN 'ok'; EXCEPTION WHEN others THEN RETURN sqlerrm; END $$;
SELECT 'other user cannot read my bump (not_found)', pg_temp.try_wait('0c', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1')) = 'not_found', '';
SELECT 'no CR in the 0509 functions', position(chr(13) in pg_get_functiondef('public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)'::regprocedure)
  || pg_get_functiondef('public.bump_wait(bigint)'::regprocedure) || pg_get_functiondef('public.olnu_bump_post(bigint)'::regprocedure)) = 0, '';
SELECT 'bump-0509 done', true, '';
ROLLBACK;
