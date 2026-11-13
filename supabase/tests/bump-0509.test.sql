-- 0509 (lane bump): Skåla med telefonen — knock MATCH, then both FINISH (drink the glass empty) = one ÖL! each.
-- LOCAL / staging copy only. One transaction, ROLLBACK at the end. Runs 0509 twice (idempotent). usage:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0509_bump_cheers.sql -f supabase/tests/bump-0509.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail; the last line is "bump-0509 done|t|". ~15 s (pg_sleep: 2 s rate limit, 1.5 s window).
\pset format unaligned
\pset tuples_only on
BEGIN;
SELECT 'before (info, not a check): 0509 already in this copy = ' || (to_regprocedure('public.bump_finish(bigint)') IS NOT NULL)::text, true, 'old code: bump_finish missing';
\i :mig
\i :mig
-- users: A–B friends, A–C strangers, A–D friends but A blocked D, A–E friends, F–G one group (no friendship)
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
-- b = knock (bump_ready), f = finish, w = wait. Errors come back as {"err": "..."}.
CREATE OR REPLACE FUNCTION pg_temp.b(who text, k text, lat float8, lng float8, ago int DEFAULT 0, kind text DEFAULT 'bump', hid boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_u(who);
  BEGIN v := public.bump_ready(lat, lng, ago, 10, true, hid, kind); EXCEPTION WHEN others THEN v := jsonb_build_object('err', sqlerrm); END;
  INSERT INTO r VALUES (k, v) ON CONFLICT ON CONSTRAINT r_pkey DO UPDATE SET j = excluded.j; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.id(k text) RETURNS bigint LANGUAGE sql AS $$ SELECT (j ->> 'id')::bigint FROM r WHERE r.k = $1 $$;
CREATE OR REPLACE FUNCTION pg_temp.f(who text, k text, kid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_u(who);
  BEGIN v := public.bump_finish(pg_temp.id(kid)); EXCEPTION WHEN others THEN v := jsonb_build_object('err', sqlerrm); END;
  INSERT INTO r VALUES (k, v) ON CONFLICT ON CONSTRAINT r_pkey DO UPDATE SET j = excluded.j; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.w(who text, k text, kid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_u(who);
  BEGIN v := public.bump_wait(pg_temp.id(kid)); EXCEPTION WHEN others THEN v := jsonb_build_object('err', sqlerrm); END;
  INSERT INTO r VALUES (k, v) ON CONFLICT ON CONSTRAINT r_pkey DO UPDATE SET j = excluded.j; RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.beers(who text) RETURNS int LANGUAGE sql AS $$
  SELECT coalesce((SELECT b.beer_count FROM public.beers b WHERE b.user_id = pg_temp.u(who)), 0) $$;
CREATE OR REPLACE FUNCTION pg_temp.jt(k text) RETURNS text LANGUAGE sql AS $$ SELECT (j - 'beer')::text || ' beer=' || coalesce(j -> 'beer' ->> 'accepted', '-') FROM r WHERE r.k = $1 $$;

-- 1. flag OFF (default) = feature_off
SELECT 'flag row added, default off', (SELECT NOT on_ FROM public.bold_flags WHERE key = 'pn_bump'), '';
SELECT 'test flag row added, default off', (SELECT NOT on_ FROM public.bold_flags WHERE key = 'pn_bump_test'), '';
SELECT 'both flags off: feature_off', pg_temp.b('0a', 'off', 60.15, 15.18) ->> 'err' = 'feature_off', pg_temp.jt('off');
-- testers only: pn_bump_test ON, pn_bump OFF → the server works, the app's flag (bold_flags_get pn_bump) stays false for everyone
UPDATE public.bold_flags SET on_ = true WHERE key = 'pn_bump_test';
SELECT 'pn_bump_test on: everyone still sees pn_bump = false', (public.bold_flags_get() ->> 'pn_bump')::boolean = false AND (public.bold_flags_get() ->> 'pn_bump_test')::boolean, '';
-- 2. MATCH: A knocks, stranger C knocks, friend B 20 m away knocks → B pairs with A. Nothing is logged yet.
SELECT 'A alone: no pair yet', (pg_temp.b('0a', 'a1', 60.15, 15.18) ->> 'pair') IS NULL, pg_temp.jt('a1');
SELECT 'stranger C: no match', (pg_temp.b('0c', 'c1', 60.15, 15.18) ->> 'pair') IS NULL, pg_temp.jt('c1');
SELECT 'friend B 20 m: match with A', (pg_temp.b('0b', 'b1', 60.15018, 15.18) ->> 'pair')::bigint = pg_temp.id('a1'), pg_temp.jt('b1');
SELECT 'match: 60 s to drink, name only', (SELECT (j ->> 'left_s')::int BETWEEN 58 AND 60 AND j -> 'matched' = '[{"name": "Kompis"}]'::jsonb FROM r WHERE k = 'b1'), pg_temp.jt('b1');
SELECT 'match alone logs NOTHING', pg_temp.beers('0a') = 0 AND pg_temp.beers('0b') = 0, '';
SELECT 'A wait: matched, mate not done, no beer', (SELECT j ->> 'pair' IS NOT NULL AND NOT (j ->> 'mate_done')::boolean AND j -> 'beer' = 'null'::jsonb FROM (SELECT pg_temp.w('0a', 'a1w', 'a1') j) z), pg_temp.jt('a1w');
SELECT 'C wait: still alone', (pg_temp.w('0c', 'c1w', 'c1') ->> 'pair') IS NULL, '';
SELECT 'finish without a match: not_matched', pg_temp.f('0c', 'c1f', 'c1') ->> 'err' = 'not_matched', pg_temp.jt('c1f');
-- 3. FINISH: B empties first → nothing yet; A empties → A logged; B's wait → B logged. Replay → nothing more.
SELECT 'B finishes first: me_done, no beer yet', (SELECT (j ->> 'me_done')::boolean AND NOT (j ->> 'both')::boolean FROM (SELECT pg_temp.f('0b', 'b1f', 'b1') j) z), pg_temp.jt('b1f');
SELECT 'one finished: still 0 beers', pg_temp.beers('0a') + pg_temp.beers('0b') = 0, '';
SELECT 'A finishes: both → A beer accepted', (SELECT (j ->> 'both')::boolean AND (j -> 'beer' ->> 'accepted')::boolean FROM (SELECT pg_temp.f('0a', 'a1f', 'a1') j) z), pg_temp.jt('a1f');
SELECT 'A: 1 beer', pg_temp.beers('0a') = 1, pg_temp.beers('0a')::text;
SELECT 'B wait: both → B beer accepted', (pg_temp.w('0b', 'b1w', 'b1') -> 'beer' ->> 'accepted')::boolean, pg_temp.jt('b1w');
SELECT 'B: 1 beer', pg_temp.beers('0b') = 1, pg_temp.beers('0b')::text;
SELECT 'replay: A finish again = same answer', (pg_temp.f('0a', 'a1f2', 'a1') -> 'beer') = (SELECT j -> 'beer' FROM r WHERE k = 'a1f'), '';
SELECT 'replay: B wait again', (pg_temp.w('0b', 'b1w2', 'b1') ->> 'both')::boolean, '';
SELECT 'replay: still 1 beer each', pg_temp.beers('0a') = 1 AND pg_temp.beers('0b') = 1, '';
SELECT 'other user cannot finish my row (not_found)', pg_temp.f('0c', 'cx', 'a1') ->> 'err' = 'not_found', '';
-- 4. rate limit: 1 knock per 2 s
-- pn_bump on for everyone (test flag off again) works the same
UPDATE public.bold_flags SET on_ = (key = 'pn_bump') WHERE key IN ('pn_bump', 'pn_bump_test');
SELECT 'A again at once: slow_down', pg_temp.b('0a', 'a2', 60.15, 15.18) ->> 'err' = 'slow_down', pg_temp.jt('a2');
SELECT pg_sleep(2.2);
-- 5. ONE finishes, the other never: nothing for anyone (window closed: matched_at moved back 61 s)
SELECT 'A + E match', (pg_temp.b('0a', 'a5', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0e', 'e5', 60.1501, 15.18) ->> 'pair')::bigint = pg_temp.id('a5'), pg_temp.jt('e5');
SELECT 'E finishes in time', (pg_temp.f('0e', 'e5f', 'e5') ->> 'me_done')::boolean, '';
UPDATE public.pn_bumps SET matched_at = matched_at - interval '61 seconds' WHERE pair_id = pg_temp.id('a5');
SELECT 'A never finished: E wait = expired, no beer', (SELECT (j ->> 'expired')::boolean AND j -> 'beer' = 'null'::jsonb FROM (SELECT pg_temp.w('0e', 'e5w', 'e5') j) z), pg_temp.jt('e5w');
SELECT 'LATE: A finishes after 60 s = expired, nothing', (SELECT (j ->> 'expired')::boolean AND NOT (j ->> 'me_done')::boolean AND j -> 'beer' = 'null'::jsonb FROM (SELECT pg_temp.f('0a', 'a5f', 'a5') j) z), pg_temp.jt('a5f');
SELECT 'one finished / late: E 0 beers, A still 1', pg_temp.beers('0e') = 0 AND pg_temp.beers('0a') = 1, '';
SELECT pg_sleep(2.2);
-- 6. both finish but the 2nd one late (finished_at after the window): nothing
SELECT 'A + E match again', (pg_temp.b('0a', 'a6', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0e', 'e6', 60.1501, 15.18) ->> 'pair')::bigint = pg_temp.id('a6'), '';
SELECT 'E finishes in time', (pg_temp.f('0e', 'e6f', 'e6') ->> 'me_done')::boolean, '';
UPDATE public.pn_bumps SET matched_at = matched_at - interval '61 seconds', finished_at = finished_at - interval '61 seconds' WHERE pair_id = pg_temp.id('a6') AND finished_at IS NOT NULL;
UPDATE public.pn_bumps SET matched_at = matched_at - interval '61 seconds' WHERE pair_id = pg_temp.id('a6') AND finished_at IS NULL;
SELECT 'A late: expired, no beer for E either', (pg_temp.f('0a', 'a6f', 'a6') ->> 'expired')::boolean AND (pg_temp.w('0e', 'e6w', 'e6') -> 'beer') = 'null'::jsonb AND pg_temp.beers('0e') = 0, pg_temp.jt('e6w');
-- forged: a finished_at set after the window by hand never counts (olnu_bump_both)
UPDATE public.pn_bumps SET finished_at = matched_at + interval '61 seconds' WHERE pair_id = pg_temp.id('a6') AND finished_at IS NULL;
SELECT 'finished after the window never counts', (pg_temp.w('0e', 'e6w2', 'e6') -> 'beer') = 'null'::jsonb AND pg_temp.beers('0e') = 0, '';
SELECT pg_sleep(2.2);
-- 7. no match: blocked friend D, friend E 80 m away, E 400 km away, knock 1.7 s apart, kind tap refused
SELECT 'A + blocked D: no match', (pg_temp.b('0a', 'a7', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0d', 'd7', 60.15, 15.18) ->> 'pair') IS NULL, pg_temp.jt('d7');
SELECT 'A + friend E 80 m away: no match (50 m rule)', (pg_temp.b('0e', 'e7', 60.15072, 15.18) ->> 'pair') IS NULL, pg_temp.jt('e7');
SELECT pg_sleep(2.2);
SELECT 'A + friend E 400 km away: no match', (pg_temp.b('0a', 'a8', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0e', 'e8', 59.33, 18.06) ->> 'pair') IS NULL, pg_temp.jt('e8');
SELECT pg_sleep(2.2);
SELECT 'knock A', (pg_temp.b('0a', 'a9', 60.15, 15.18) ->> 'pair') IS NULL, '';
SELECT pg_sleep(1.7);
SELECT 'knock B 1.7 s later: no match', (pg_temp.b('0b', 'b9', 60.15, 15.18) ->> 'pair') IS NULL, pg_temp.jt('b9');
SELECT pg_sleep(0.4);
SELECT 'E: p_ago_ms 1000 puts the knock 1.1 s after A = match', (pg_temp.b('0e', 'e9', 60.1501, 15.18, 1000) ->> 'pair')::bigint = pg_temp.id('a9'), pg_temp.jt('e9');
SELECT 'kind tap refused (no fallback)', pg_temp.b('0c', 'c9', 60.15, 15.18, 0, 'tap') ->> 'err' = 'invalid_kind', '';
SELECT pg_sleep(2.2);
-- 8. same limits as ÖL!: A + B both finish again → the 10-min rule refuses both, still 1 beer each
SELECT 'A + B match', (pg_temp.b('0a', 'a10', 60.15, 15.18) ->> 'pair') IS NULL AND (pg_temp.b('0b', 'b10', 60.15, 15.18) ->> 'pair')::bigint = pg_temp.id('a10'), '';
SELECT 'both finish', (pg_temp.f('0a', 'a10f', 'a10') ->> 'me_done')::boolean AND (pg_temp.f('0b', 'b10f', 'b10') ->> 'both')::boolean, '';
SELECT 'same limits: B refused (cooldown)', (SELECT (j -> 'beer' ->> 'accepted')::boolean = false AND (j -> 'beer' ->> 'wait_seconds')::int > 500 FROM r WHERE k = 'b10f'), pg_temp.jt('b10f');
SELECT 'same limits: A refused too', (pg_temp.w('0a', 'a10w', 'a10') -> 'beer' ->> 'accepted')::boolean = false, pg_temp.jt('a10w');
SELECT 'same limits: still 1 beer each', pg_temp.beers('0a') = 1 AND pg_temp.beers('0b') = 1, '';
-- 9. group members (no friendship), same checked-in bar, no GPS; spökläge = hidden beer
INSERT INTO public.checkins (user_id, bar_id, bar_name, lat, lng) VALUES
  (pg_temp.u('0f'), 'osm-n-509', 'Bumpbaren', 60.1499, 15.1801), (pg_temp.u('1a'), 'osm-n-509', 'Bumpbaren', 60.1499, 15.1801);
SELECT 'group F (spöke), no GPS, at the bar', (pg_temp.b('0f', 'f11', NULL, NULL, 0, 'bump', true) ->> 'pair') IS NULL, pg_temp.jt('f11');
SELECT 'group G, no GPS, same bar: match', (pg_temp.b('1a', 'g11', NULL, NULL) ->> 'pair')::bigint = pg_temp.id('f11'), pg_temp.jt('g11');
SELECT 'G sees the group name Fia', (SELECT j -> 'matched' -> 0 ->> 'name' = 'Fia' FROM r WHERE k = 'g11'), '';
SELECT 'F finishes', (pg_temp.f('0f', 'f11f', 'f11') ->> 'me_done')::boolean, '';
SELECT 'G finishes: beer at the bar, visible', (SELECT (j -> 'beer' ->> 'accepted')::boolean AND NOT (j -> 'beer' ->> 'hidden')::boolean FROM (SELECT pg_temp.f('1a', 'g11f', 'g11') j) z), pg_temp.jt('g11f');
SELECT 'F wait: spökläge beer hidden', (pg_temp.w('0f', 'f11w', 'f11') -> 'beer' ->> 'hidden')::boolean, pg_temp.jt('f11w');
SELECT 'F spökläge: no pin (stopped + ghost)', (SELECT stopped AND ghost FROM public.beers WHERE user_id = pg_temp.u('0f')), '';
-- 10. privacy: positions are cleared after 10 min (at the next knock anywhere)
UPDATE public.pn_bumps SET at = at - interval '11 minutes' WHERE user_id = pg_temp.u('0c');
SELECT pg_sleep(2.1);
SELECT 'a new knock', (pg_temp.b('0e', 'e12', 60.15, 15.18) ->> 'id') IS NOT NULL, pg_temp.jt('e12');
SELECT 'old positions set to null', NOT EXISTS (SELECT 1 FROM public.pn_bumps WHERE user_id = pg_temp.u('0c') AND lat IS NOT NULL), '';
SELECT 'new positions kept', EXISTS (SELECT 1 FROM public.pn_bumps WHERE user_id = pg_temp.u('0e') AND lat IS NOT NULL), '';
-- 11. grants + CR + bad input
SELECT 'anon cannot call bump_ready / bump_finish / bump_wait',
  NOT has_function_privilege('anon', 'public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)', 'execute')
  AND NOT has_function_privilege('anon', 'public.bump_finish(bigint)', 'execute') AND NOT has_function_privilege('anon', 'public.bump_wait(bigint)', 'execute'), '';
SELECT 'authenticated: bump_* yes, olnu_bump_post / olnu_bump_both / olnu_bump_on no',
  has_function_privilege('authenticated', 'public.bump_finish(bigint)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.olnu_bump_post(bigint)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.olnu_bump_both(public.pn_bumps)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.olnu_bump_on()', 'execute'), '';
UPDATE public.bold_flags SET on_ = false WHERE key IN ('pn_bump', 'pn_bump_test');
SELECT pg_sleep(2.1);
SELECT 'both off again: feature_off', pg_temp.b('0b', 'off2', 60.15, 15.18) ->> 'err' = 'feature_off', '';
UPDATE public.bold_flags SET on_ = true WHERE key = 'pn_bump';
SELECT 'half position refused', pg_temp.b('0b', 'x2', 60.15, NULL) ->> 'err' = 'invalid_pos', '';
SELECT 'no CR in the 0509 functions', position(chr(13) in pg_get_functiondef('public.bump_ready(double precision,double precision,integer,double precision,boolean,boolean,text)'::regprocedure)
  || pg_get_functiondef('public.bump_finish(bigint)'::regprocedure) || pg_get_functiondef('public.olnu_bump_post(bigint)'::regprocedure)) = 0, '';
SELECT 'bump-0509 done', true, '';
ROLLBACK;
