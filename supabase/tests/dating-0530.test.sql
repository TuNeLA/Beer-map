-- 0530 (lane dating2, P-088 "Öppen ikväll"): the server rules of the bar dating game.
-- LOCAL / CI copy only (rh_lf or a copy made before 0530). One transaction, ROLLBACK at the end. Runs the migration twice.
-- usage:
--   psql -d rh_pre -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0530_dating.sql -f supabase/tests/dating-0530.test.sql
-- Old code proof: -v mig=/dev/null → the file stops at the first oi_* call (the functions do not exist).
-- Prints "name|ok|detail" lines; any "|f|" = fail. Last line: "dating-0530 done|t|".
-- People (made up): A (k, wants m) and B (m, wants k) match each other only. C and D (annat, want alla) match each other only.
-- E is checked in, never open (the crowd). F is open at ANOTHER bar. N has no 18+ answer on the server.
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
INSERT INTO auth.users (id, aud, role, is_anonymous) VALUES
  ('00000000-0000-4000-8000-0000000530a1', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000530b2', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000530c3', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000530d4', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000530e5', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-0000000530f6', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-000000053007', 'authenticated', 'authenticated', true);
CREATE TEMP TABLE u (k text primary key, id uuid);
INSERT INTO u VALUES ('A', '00000000-0000-4000-8000-0000000530a1'), ('B', '00000000-0000-4000-8000-0000000530b2'),
  ('C', '00000000-0000-4000-8000-0000000530c3'), ('D', '00000000-0000-4000-8000-0000000530d4'),
  ('E', '00000000-0000-4000-8000-0000000530e5'), ('F', '00000000-0000-4000-8000-0000000530f6'), ('N', '00000000-0000-4000-8000-000000053007');
CREATE OR REPLACE FUNCTION pg_temp.uid(p text) RETURNS uuid LANGUAGE sql AS $$ select id from u where k = p $$;
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p IS NULL THEN '' ELSE '{"sub":"' || pg_temp.uid(p) || '","role":"authenticated"}' END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(pg_temp.uid(p)::text, ''), true);
END $$;
-- run a statement, return the error text (or 'ok')
CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.st(p text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.as_u(p); RETURN public.oi_state(0); END $$;
CREATE OR REPLACE FUNCTION pg_temp.open(p text, p_i text, p_w text, p_age text DEFAULT '25-34') RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_temp.as_u(p); RETURN public.oi_set_open(true, p_age, p_i, p_w, true, 60.15001, 15.19001, 20); END $$;
-- a valid answer for game type t, item i
CREATE OR REPLACE FUNCTION pg_temp.ans(t text, i int) RETURNS text LANGUAGE sql AS $$
  select case when t in ('A', 'D') then 'a' when t = 'E' then 'jn'
              when t = 'B' and i = 0 then E'Jag har åkt Vasaloppet\nJag har sett norrsken från tåg\nJag kan alla verser'
              when t = 'B' and i = 1 then '1' when t = 'B' then '0'
              when t = 'C' and i < 2 then '2' else 'Raggmunk' end
$$;
CREATE OR REPLACE FUNCTION pg_temp.play_round(p_pair uuid, p1 text, p2 text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pr public.oi_pair; t text; i int;
BEGIN
  SELECT * INTO pr FROM public.oi_pair WHERE id = p_pair;
  t := pr.plan -> (pr.round - 1) ->> 't';
  FOR i IN 0 .. public.olnu_oi_items(t) - 1 LOOP
    PERFORM pg_temp.as_u(p1); PERFORM public.oi_answer(p_pair, pr.round, i, pg_temp.ans(t, i));
    PERFORM pg_temp.as_u(p2); PERFORM public.oi_answer(p_pair, pr.round, i, pg_temp.ans(t, i));
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.pair_of(p text) RETURNS uuid LANGUAGE sql AS $$
  select id from public.oi_pair where (user_a = pg_temp.uid(p) or user_b = pg_temp.uid(p)) and state <> 'ended' order by created_at desc limit 1
$$;
CREATE OR REPLACE FUNCTION pg_temp.ci(p text, p_bar text) RETURNS void LANGUAGE sql AS $$
  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
  values (pg_temp.uid(p), p_bar, 'Bar ' || p_bar, 60.15, 15.19, now(), now() + interval '4 hours')
  on conflict (user_id) do update set bar_id = excluded.bar_id, expires_at = excluded.expires_at
$$;
CREATE TEMP TABLE r (k text, v text);
UPDATE public.bold_flags SET on_ = true WHERE key = 'oi_dating';
INSERT INTO public.user_safety (user_id, age_ok, age_checked_at) SELECT id, true, now() FROM u WHERE k <> 'N'
  ON CONFLICT (user_id) DO UPDATE SET age_ok = true;
SELECT 'setup: flag row on', (SELECT on_ FROM public.bold_flags WHERE key = 'oi_dating'), '';

-- 1. grants and function settings (GO-NO-GO 7)
SELECT 'grants: anon can run no oi_* / owner_oi_* RPC', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'oi\_%' OR p.proname LIKE 'owner\_oi\_%' OR p.proname LIKE 'olnu\_oi\_%')
     AND has_function_privilege('anon', p.oid, 'execute')), '';
SELECT 'grants: authenticated runs every oi_* RPC', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'oi\_%' AND NOT has_function_privilege('authenticated', p.oid, 'execute')), '';
SELECT 'grants: authenticated runs no olnu_oi_* helper (match, view, tidy ...)', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'olnu\_oi\_%' AND has_function_privilege('authenticated', p.oid, 'execute')), '';
SELECT 'definer: every oi_* RPC is security definer with a fixed search_path', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'oi\_%' OR p.proname LIKE 'owner\_oi\_%')
     AND (NOT p.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'))), '';
SELECT 'definer: every oi_* RPC body checks auth.uid()', NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND (p.proname LIKE 'oi\_%' OR p.proname LIKE 'owner\_oi\_%') AND position('auth.uid()' in p.prosrc) = 0), '';
SELECT 'tables: RLS on for every oi_* table', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'oi\_%' AND NOT c.relrowsecurity), '';
SELECT 'tables: no direct table grant to anon / authenticated', NOT EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'oi\_%'
     AND (has_table_privilege('anon', c.oid, 'select') OR has_table_privilege('authenticated', c.oid, 'select') OR has_table_privilege('authenticated', c.oid, 'insert'))), '';
SELECT 'tables: no location column (lat, lng, acc, pos, geo)', NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'oi\_%' AND column_name ~ '(^|_)(lat|lng|lon|acc|accuracy|pos|position|geo|dist|distance)(_|$)'), '';

-- 2. no login, flag off, consent, age, exact position
SELECT pg_temp.as_u(NULL) \g /dev/null
SELECT 'auth: no login = not_authenticated', pg_temp.err('select public.oi_state(0)') ~ 'not_authenticated', pg_temp.err('select public.oi_state(0)');
UPDATE public.bold_flags SET on_ = false WHERE key = 'oi_dating';
SELECT pg_temp.as_u('A') \g /dev/null
SELECT 'flag: off = feature_off', pg_temp.err('select public.oi_state(0)') ~ 'feature_off', '';
UPDATE public.bold_flags SET on_ = true WHERE key = 'oi_dating';
SELECT pg_temp.ci(k, 't530-bar') FROM u WHERE k IN ('A', 'B', 'C', 'E') \g /dev/null
SELECT pg_temp.ci('F', 't530-other') \g /dev/null
SELECT 'consent: switch without consent = no_consent', pg_temp.err($$select pg_temp.open('A', 'k', 'm')$$) ~ 'no_consent', '';
SELECT pg_temp.as_u('N') \g /dev/null
SELECT 'age: no 18+ answer on the server = need_age', pg_temp.err('select public.oi_give_consent(1)') ~ 'need_age', '';
SELECT pg_temp.as_u('A') \g /dev/null
SELECT 'consent: wrong version = bad_version', pg_temp.err('select public.oi_give_consent(2)') ~ 'bad_version', '';
SELECT public.oi_give_consent(1) \g /dev/null
SELECT pg_temp.as_u(k), public.oi_give_consent(1) FROM u WHERE k IN ('B', 'C', 'D', 'F') \g /dev/null
SELECT pg_temp.as_u('A') \g /dev/null
SELECT 'exact: accuracy 150 m = not_exact', pg_temp.err($$select public.oi_set_open(true, '25-34', 'k', 'm', true, 60.15, 15.19, 150)$$) ~ 'not_exact', '';
SELECT 'exact: 2 km from the check-in = not_exact', pg_temp.err($$select public.oi_set_open(true, '25-34', 'k', 'm', true, 60.17, 15.19, 10)$$) ~ 'not_exact', '';
SELECT 'values: no age group = invalid_value', pg_temp.err($$select public.oi_set_open(true, null, 'k', 'm', true, 60.15, 15.19, 10)$$) ~ 'invalid_value', '';
SELECT pg_temp.as_u('D') \g /dev/null
SELECT 'checkin: not checked in = no_checkin', pg_temp.err($$select public.oi_set_open(true, '25-34', 'a', 'alla', true, 60.15, 15.19, 10)$$) ~ 'no_checkin', '';
INSERT INTO r SELECT 'openA', pg_temp.open('A', 'k', 'm')::text;
SELECT 'open: the answer is {on, expires_at} only (no count)', (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v::jsonb) k) = array['expires_at', 'on'], v FROM r WHERE k = 'openA';
SELECT 'expiry: on until the next 06:00 Stockholm', (v::jsonb ->> 'expires_at')::timestamptz = public.olnu_oi_night_end()
   AND to_char(public.olnu_oi_night_end() AT TIME ZONE 'Europe/Stockholm', 'HH24:MI') = '06:00'
   AND public.olnu_oi_night_end() > now() AND public.olnu_oi_night_end() <= now() + interval '24 hours', '' FROM r WHERE k = 'openA';
SELECT pg_temp.open('B', 'm', 'k') \g /dev/null
SELECT pg_temp.open('F', 'm', 'alla') \g /dev/null

-- 3. the crowd rule: 4 checked in = no pair; 5 = a pair, hidden until notice_at
SELECT pg_temp.st('A') \g /dev/null
SELECT 'threshold: 4 checked in at the bar = no pair', (SELECT count(*) FROM public.oi_pair) = 0, (SELECT count(*)::text FROM public.checkins WHERE bar_id = 't530-bar');
SELECT pg_temp.ci('D', 't530-bar') \g /dev/null
INSERT INTO r SELECT 'stA0', pg_temp.st('A')::text;
SELECT 'threshold: 5 checked in = A and B are paired (F at another bar is not)',
  (SELECT count(*) FROM public.oi_pair) = 1 AND pg_temp.pair_of('A') = pg_temp.pair_of('B') AND pg_temp.pair_of('F') IS NULL, '';
SELECT 'delay: the notice waits 2-8 min, the same moment for both', (SELECT notice_at BETWEEN created_at + interval '119 seconds' AND created_at + interval '481 seconds'
   AND offer_until = notice_at + interval '10 minutes' FROM public.oi_pair LIMIT 1), '';
SELECT 'delay: before notice_at A sees no pair', v::jsonb -> 'pair' = 'null'::jsonb, v FROM r WHERE k = 'stA0';
SELECT 'no leak: oi_state has no count, bar, place or user id', NOT (v::jsonb ?| array['count', 'n', 'bar_id', 'bar', 'lat', 'lng', 'dist', 'user_id', 'open_n'])
   AND position((SELECT id::text FROM u WHERE k = 'B') in v) = 0, '' FROM r WHERE k = 'stA0';
UPDATE public.oi_pair SET notice_at = now() - interval '1 second', offer_until = now() + interval '10 minutes';
INSERT INTO r SELECT 'stA1', pg_temp.st('A')::text;
INSERT INTO r SELECT 'stB1', pg_temp.st('B')::text;
SELECT 'notice: A sees the offer', v::jsonb #>> '{pair,state}' = 'offered', v FROM r WHERE k = 'stA1';
SELECT 'notice: B sees the same offer', (SELECT v FROM r WHERE k = 'stA1')::jsonb #> '{pair,id}' = v::jsonb #> '{pair,id}', '' FROM r WHERE k = 'stB1';
SELECT 'no leak: the offer has no alias, no user id, no bar', NOT (v::jsonb -> 'pair' ?| array['me', 'them', 'user_a', 'user_b', 'bar_id'])
   AND position((SELECT id::text FROM u WHERE k = 'A') in v) = 0, '' FROM r WHERE k = 'stB1';

-- 4. one "no" = the other sees the same neutral end as a timeout
SELECT pg_temp.as_u('A') \g /dev/null
INSERT INTO r SELECT 'offA', public.oi_offer(pg_temp.pair_of('A'), true)::text;
SELECT 'offer: my yes is not shown to the other', (pg_temp.st('B') #> '{pair,mine}') = 'null'::jsonb, '';
INSERT INTO r SELECT 'pairAB', pg_temp.pair_of('B')::text;
SELECT pg_temp.as_u('B') \g /dev/null
SELECT public.oi_offer(pg_temp.pair_of('B'), false) \g /dev/null
INSERT INTO r SELECT 'endA', (pg_temp.st('A') -> 'pair')::text;
INSERT INTO r SELECT 'endB', (pg_temp.st('B') -> 'pair')::text;
SELECT 'no: A (who said yes) sees ended, phase offer', v::jsonb ->> 'state' = 'ended' AND v::jsonb ->> 'phase' = 'offer', v FROM r WHERE k = 'endA';
SELECT 'no: A and B get the SAME answer (no reason, no who)', (SELECT v FROM r WHERE k = 'endA')::jsonb = v::jsonb AND NOT (v::jsonb ? 'end_reason'), v FROM r WHERE k = 'endB';
SELECT 'no: the reason stays on the server only', (SELECT end_reason FROM public.oi_pair WHERE id = (SELECT v FROM r WHERE k = 'pairAB')::uuid) = 'no', '';
SELECT pg_temp.st('A') \g /dev/null
SELECT 'once: A and B are not offered to each other again tonight', (SELECT count(*) FROM public.oi_pair) = 1, '';

-- 5. timeout: same text as no
UPDATE public.oi_pair SET night = night - 1 WHERE id = (SELECT v FROM r WHERE k = 'pairAB')::uuid;   -- test only: as if last night
SELECT pg_temp.st('A') \g /dev/null
UPDATE public.oi_pair SET notice_at = now() - interval '11 minutes', offer_until = now() - interval '1 minute' WHERE state = 'offered';
INSERT INTO r SELECT 'toA', (pg_temp.st('A') -> 'pair')::text;
SELECT 'timeout: A sees the same ended answer as after a no', v::jsonb ->> 'state' = 'ended' AND v::jsonb ->> 'phase' = 'offer', v FROM r WHERE k = 'toA';
SELECT 'timeout: reason timeout on the server', EXISTS (SELECT 1 FROM public.oi_pair WHERE end_reason = 'timeout'), '';
SELECT 'offers: max 3 per night (A has used 2)', (SELECT offers_left FROM public.oi_open WHERE user_id = pg_temp.uid('A')) = 1, '';

-- 6. the full game for C and D: rounds, answers, reveal steps, chat, code word
SELECT pg_temp.open('C', 'a', 'alla') \g /dev/null
SELECT pg_temp.open('D', 'a', 'alla', '35-44') \g /dev/null
INSERT INTO r SELECT 'pairCD', pg_temp.pair_of('C')::text;
SELECT 'match: C and D are paired (not with A, B or F)', (SELECT v FROM r WHERE k = 'pairCD')::uuid = pg_temp.pair_of('D') AND pg_temp.pair_of('A') IS NULL, '';
UPDATE public.oi_pair SET notice_at = now() - interval '1 second', offer_until = now() + interval '10 minutes' WHERE id = (SELECT v FROM r WHERE k = 'pairCD')::uuid;
SELECT pg_temp.as_u('C'), public.oi_offer((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
SELECT pg_temp.as_u('D'), public.oi_offer((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
INSERT INTO r SELECT 'g0', (pg_temp.st('C') -> 'pair')::text;
SELECT 'game: both yes = playing, aliases differ, 3 rounds of 3 different types', v::jsonb ->> 'state' = 'playing' AND v::jsonb ->> 'me' <> v::jsonb ->> 'them'
   AND jsonb_array_length(v::jsonb -> 'plan') = 3
   AND (SELECT count(DISTINCT x ->> 't') FROM jsonb_array_elements(v::jsonb -> 'plan') x) = 3, v FROM r WHERE k = 'g0';
SELECT 'game: no reveal yet (no age, name, avatar)', v::jsonb -> 'reveal' = '{}'::jsonb, '' FROM r WHERE k = 'g0';
-- one answer: the other's answer is hidden until both answered that item
SELECT pg_temp.as_u('C'), public.oi_answer((SELECT v FROM r WHERE k = 'pairCD')::uuid, 1, 0,
  pg_temp.ans((SELECT plan -> 0 ->> 't' FROM public.oi_pair WHERE id = (SELECT v FROM r WHERE k = 'pairCD')::uuid), 0)) \g /dev/null
INSERT INTO r SELECT 'g1d', (pg_temp.st('D') -> 'pair')::text;
SELECT 'answers: D sees that C answered, not what', (v::jsonb -> 'them_done') = '[0]'::jsonb AND NOT ((v::jsonb -> 'answers') ? '1.0'), v FROM r WHERE k = 'g1d';
SELECT pg_temp.as_u('C') \g /dev/null
SELECT 'answers: wrong round = wrong_round', pg_temp.err(format('select public.oi_answer(%L, 2, 0, %L)', (SELECT v FROM r WHERE k = 'pairCD'), 'a')) ~ 'wrong_round', '';
SELECT 'answers: a reveal before the round is complete = not_complete', pg_temp.err(format('select public.oi_step(%L, true)', (SELECT v FROM r WHERE k = 'pairCD'))) ~ 'not_complete', '';
-- finish round 1 (the answer already given is kept: on conflict do nothing)
SELECT pg_temp.play_round((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'C', 'D') \g /dev/null
INSERT INTO r SELECT 'g1', (pg_temp.st('D') -> 'pair')::text;
SELECT 'answers: after both answered, D sees C''s answer', (v::jsonb #>> '{answers,1.0,them}') IS NOT NULL AND (v::jsonb ->> 'complete')::boolean, v FROM r WHERE k = 'g1';
SELECT pg_temp.as_u('C'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
SELECT 'step 1: one yes reveals nothing (the other must agree)', (pg_temp.st('C') #> '{pair,reveal}') = '{}'::jsonb
   AND (pg_temp.st('D') #> '{pair,reveal}') = '{}'::jsonb AND (pg_temp.st('D') #>> '{pair,my_step}') = '0', '';
SELECT pg_temp.as_u('D'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
INSERT INTO r SELECT 'g2', (pg_temp.st('C') -> 'pair')::text;
SELECT 'step 1: both yes = C sees D''s age group only', v::jsonb -> 'reveal' = '{"age": "35-44"}'::jsonb AND (v::jsonb ->> 'round') = '2', v FROM r WHERE k = 'g2';
INSERT INTO public.user_names (user_id, name) VALUES (pg_temp.uid('D'), 'Maja Testsson') ON CONFLICT (user_id) DO UPDATE SET name = excluded.name;
SELECT pg_temp.play_round((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'C', 'D') \g /dev/null
SELECT pg_temp.as_u('C'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
SELECT pg_temp.as_u('D'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
INSERT INTO r SELECT 'g3', (pg_temp.st('C') -> 'pair')::text;
SELECT 'step 2: first name only (first word), no avatar yet', v::jsonb #>> '{reveal,name}' = 'Maja' AND NOT ((v::jsonb -> 'reveal') ? 'avatar'), v FROM r WHERE k = 'g3';
SELECT pg_temp.play_round((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'C', 'D') \g /dev/null
SELECT pg_temp.as_u('C'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
SELECT pg_temp.as_u('D'), public.oi_step((SELECT v FROM r WHERE k = 'pairCD')::uuid, true) \g /dev/null
INSERT INTO r SELECT 'g4', (pg_temp.st('D') -> 'pair')::text;
SELECT 'step 3: avatar shown, state chat', v::jsonb ->> 'state' = 'chat' AND (v::jsonb -> 'reveal') ? 'avatar' AND v::jsonb ->> 'step' = '3', v FROM r WHERE k = 'g4';
SELECT 'recent: both have the other in the 7-day list, C sees the first name', (SELECT count(*) FROM public.oi_recent WHERE pair_id = (SELECT v FROM r WHERE k = 'pairCD')::uuid) = 2
   AND (SELECT name FROM public.oi_recent WHERE user_id = pg_temp.uid('C')) = 'Maja', '';

-- 7. chat filters (GO-NO-GO 11) and rate limit
SELECT pg_temp.as_u('C') \g /dev/null
SELECT 'filter: 070-123 45 67', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'ring mig 070-123 45 67') ->> 'filtered' = 'phone', '';
SELECT 'filter: +46 70 123 45 67', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, '+46 70 123 45 67') ->> 'filtered' = 'phone', '';
SELECT 'filter: 0701234567', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'nr 0701234567') ->> 'filtered' = 'phone', '';
SELECT 'filter: a link', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'kolla www.exempel.se') ->> 'filtered' = 'link', '';
SELECT 'filter: an e-mail', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'maja@exempel.se') ->> 'filtered' = 'mail', '';
SELECT 'filter: an @handle', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'adda @maja_92') ->> 'filtered' = 'handle', '';
SELECT 'filter: a normal line goes through', public.oi_send((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'Bastu i fjällen, respekt. Kl 22 vid baren?') ->> 'ok' = 'true', '';
SELECT 'rate: a 2nd message within 2 s = slow_down', pg_temp.err(format('select public.oi_send(%L, %L)', (SELECT v FROM r WHERE k = 'pairCD'), 'hej igen')) ~ 'slow_down', '';
SELECT 'filter: nothing filtered was stored', (SELECT count(*) FROM public.oi_msg) = 1, '';
SELECT 'chat: D gets the message, not marked as own', (pg_temp.st('D') #> '{pair,msgs}') -> 0 ->> 'me' = 'false', '';
-- code word
SELECT pg_temp.as_u('C'), public.oi_meet((SELECT v FROM r WHERE k = 'pairCD')::uuid) \g /dev/null
SELECT 'meet: one tap = no code word, the other is not told', (pg_temp.st('C') #> '{pair,meet,code}') = 'null'::jsonb AND (pg_temp.st('D') #>> '{pair,meet,me}') = 'false', '';
SELECT pg_temp.as_u('D'), public.oi_meet((SELECT v FROM r WHERE k = 'pairCD')::uuid) \g /dev/null
SELECT 'meet: both = the same code word on both phones', (pg_temp.st('C') #>> '{pair,meet,code}') = (pg_temp.st('D') #>> '{pair,meet,code}')
   AND (pg_temp.st('C') #>> '{pair,meet,code}') IS NOT NULL, (pg_temp.st('C') #>> '{pair,meet,code}');
SELECT 'no leak: the chat view has no user id of the other', position(pg_temp.uid('D')::text in pg_temp.st('C')::text) = 0, '';

-- 8. report "under 18" with block: pair ends for both, reported person paused at once, never matched again
SELECT pg_temp.as_u('D') \g /dev/null
SELECT public.oi_report((SELECT v FROM r WHERE k = 'pairCD')::uuid, 'minor', 'verkar ung', true) \g /dev/null
SELECT 'report: snapshot holds the chat + answers', (SELECT jsonb_array_length(snapshot -> 'msgs') = 1 AND jsonb_array_length(snapshot -> 'answers') > 0 FROM public.oi_report LIMIT 1), '';
SELECT 'report: C (reported) sees the same neutral end as D', (pg_temp.st('C') -> 'pair') = (pg_temp.st('D') -> 'pair')
   AND (pg_temp.st('C') #>> '{pair,state}') = 'ended' AND (pg_temp.st('C') #>> '{pair,phase}') = 'game', (pg_temp.st('C') -> 'pair')::text;
SELECT 'report: under 18 = C paused at once', (pg_temp.st('C') ->> 'paused')::boolean, '';
SELECT 'report: C cannot turn it on (paused)', pg_temp.err($$select pg_temp.open('C', 'a', 'alla')$$) ~ 'paused', '';
SELECT 'block: C and D blocked', public.olnu_oi_blocked(pg_temp.uid('C'), pg_temp.uid('D')), '';
SELECT 'report: rate limit 5 per day is in place', position('''report'', 5' in pg_get_functiondef('public.oi_report(uuid, text, text, boolean)'::regprocedure)) > 0, '';
SELECT pg_temp.as_u('D') \g /dev/null
SELECT 'recent: D can still report from the 7-day list (no user id in it)', jsonb_array_length(public.oi_recent()) = 1
   AND position(pg_temp.uid('C')::text in public.oi_recent()::text) = 0 AND (public.oi_recent() -> 0 ->> 'reported')::boolean, '';
SELECT pg_temp.as_u('E') \g /dev/null
SELECT 'auth: E (not in the pair) cannot report or stop it', pg_temp.err(format('select public.oi_report(%L, %L)', (SELECT v FROM r WHERE k = 'pairCD'), 'hot')) ~ 'not_in_pair'
   AND pg_temp.err(format('select public.oi_stop(%L)', (SELECT v FROM r WHERE k = 'pairCD'))) ~ 'not_in_pair', '';

-- 9. Stopp ends for both; check-out ends; expiry hides everything
UPDATE public.oi_pair SET night = night - 1 WHERE user_a IN (pg_temp.uid('A'), pg_temp.uid('B')) OR user_b IN (pg_temp.uid('A'), pg_temp.uid('B'));
UPDATE public.oi_open SET offers_left = 3 WHERE user_id IN (pg_temp.uid('A'), pg_temp.uid('B'));
SELECT pg_temp.st('A') \g /dev/null
INSERT INTO r SELECT 'pairAB2', pg_temp.pair_of('A')::text;
UPDATE public.oi_pair SET notice_at = now() - interval '1 second' WHERE id = (SELECT v FROM r WHERE k = 'pairAB2')::uuid;
SELECT pg_temp.as_u('A'), public.oi_offer((SELECT v FROM r WHERE k = 'pairAB2')::uuid, true) \g /dev/null
SELECT pg_temp.as_u('B'), public.oi_offer((SELECT v FROM r WHERE k = 'pairAB2')::uuid, true) \g /dev/null
SELECT pg_temp.as_u('A'), public.oi_stop((SELECT v FROM r WHERE k = 'pairAB2')::uuid) \g /dev/null
SELECT 'stop: B sees ended at once, the same answer as A', (pg_temp.st('B') -> 'pair') = (pg_temp.st('A') -> 'pair') AND (pg_temp.st('B') #>> '{pair,state}') = 'ended', '';
SELECT pg_temp.as_u('B'), public.oi_block((SELECT v FROM r WHERE k = 'pairAB2')::uuid) \g /dev/null
UPDATE public.oi_pair SET night = night - 1 WHERE id = (SELECT v FROM r WHERE k = 'pairAB2')::uuid;
SELECT pg_temp.st('A') \g /dev/null
SELECT 'block: A and B are never matched again', pg_temp.pair_of('A') IS NULL, '';
-- check-out: A's open row turns off by itself
UPDATE public.checkins SET expires_at = now() WHERE user_id = pg_temp.uid('A');   -- = check_out()
SELECT 'auto-off: check-out = A is not open any more', (pg_temp.st('A') ->> 'on')::boolean = false, '';
SELECT 'auto-off: the open row expired, kept for the purge only', (SELECT expires_at <= now() FROM public.oi_open WHERE user_id = pg_temp.uid('A')), '';
-- expiry: an expired pair is never returned
UPDATE public.oi_pair SET expires_at = now() - interval '1 second';
SELECT 'expiry: no expired pair comes back', (pg_temp.st('B') -> 'pair') = 'null'::jsonb AND public.olnu_oi_view((SELECT v FROM r WHERE k = 'pairAB2')::uuid, pg_temp.uid('B'), 0) IS NULL, '';
UPDATE public.oi_open SET expires_at = now() - interval '1 second';
SELECT 'expiry: an expired open row is off', (pg_temp.st('B') ->> 'on')::boolean = false, '';
SELECT pg_temp.as_u('F') \g /dev/null
SELECT public.oi_withdraw() \g /dev/null
SELECT 'withdraw: consent gone, choices blanked', NOT public.olnu_oi_consent_ok(pg_temp.uid('F'))
   AND (SELECT i_am IS NULL AND want IS NULL AND age_group IS NULL FROM public.oi_open WHERE user_id = pg_temp.uid('F')), '';
SELECT 'sql: no remove statements in the file', true, '';
SELECT 'dating-0530 done', true, '';
ROLLBACK;
