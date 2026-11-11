-- 0497 (lane ownerfix item 7): event tip auto rules. LOCAL / staging copy only. One transaction, ROLLBACK at the end.
-- Runs 0497 twice (idempotent). usage:
--   psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0497_ownerfix_event_auto.sql -f supabase/tests/ownerfix-0497.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
\i :mig
\i :mig
-- users: A anonymous new · B saved account · C anonymous with an approved tip · D/E/F reporters · G penalty
INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES
  ('00000000-0000-4000-8000-00000004970a', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-00000004970b', 'authenticated', 'authenticated', 'b@example.com', false),
  ('00000000-0000-4000-8000-00000004970c', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-00000004970d', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-00000004970e', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-00000004970f', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-4000-8000-000000049710', 'authenticated', 'authenticated', 'g@example.com', false);
CREATE OR REPLACE FUNCTION pg_temp.as_u(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"' || p || '","role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.sub', p, true);
END $$;
INSERT INTO public.bars_lite (id, name, lat, lng, type, active) VALUES ('of-pub-1', 'Testpuben', 60.15000, 15.18000, 'pub', true)
  ON CONFLICT (id) DO UPDATE SET active = true, lat = excluded.lat, lng = excluded.lng;
CREATE TEMP TABLE r (k text, j jsonb);
-- (d) brand-new anonymous user at a known bar → pending (new_user)
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970a');
INSERT INTO r SELECT 'a1', public.submit_event('Pubquiz med Kalle', now() + interval '2 days', 'of-pub-1', null, null, null, 'quiz', null);
SELECT 'new anonymous user, known bar: pending (new_user)', j ->> 'status' = 'pending' AND j ->> 'reason' = 'new_user', j::text FROM r WHERE k = 'a1';
-- (a) saved account at a known bar → ok at once
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970b');
INSERT INTO r SELECT 'b1', public.submit_event('Livemusik: Bandet', now() + interval '3 days', 'of-pub-1', null, null, null, 'music', null);
SELECT 'saved account, known bar: ok at once (auto:account)', j ->> 'status' = 'ok' AND j ->> 'reason' = 'auto:account', j::text FROM r WHERE k = 'b1';
-- (d) saved account, NOT at a known bar → pending (not_bar)
UPDATE public.bar_events SET created_at = now() - interval '1 minute' WHERE created_by = '00000000-0000-4000-8000-00000004970b';
INSERT INTO r SELECT 'b2', public.submit_event('Fest i skogen', now() + interval '3 days', null, 'Skogen', 61.5, 16.5, 'other', null);
SELECT 'saved account, no known bar: pending (not_bar)', j ->> 'status' = 'pending' AND j ->> 'reason' = 'not_bar', j::text FROM r WHERE k = 'b2';
-- ~100 m rule: 80 m from the pub without a bar id → known bar
UPDATE public.bar_events SET created_at = now() - interval '1 minute' WHERE created_by = '00000000-0000-4000-8000-00000004970b';
INSERT INTO r SELECT 'b3', public.submit_event('Afterwork', now() + interval '4 days', null, 'Gatan', 60.15072, 15.18000, 'other', null);
SELECT 'within ~100 m of a known bar counts as the bar', j ->> 'status' = 'ok', j::text FROM r WHERE k = 'b3';
-- (b) max 3 per user per day → tip_limit
UPDATE public.bar_events SET created_at = now() - interval '1 minute' WHERE created_by = '00000000-0000-4000-8000-00000004970b';
DO $$ BEGIN
  PERFORM public.submit_event('Fjärde tipset', now() + interval '5 days', 'of-pub-1', null, null, null, 'other', null);
  RAISE NOTICE 'no limit';
EXCEPTION WHEN others THEN
  INSERT INTO r VALUES ('lim', jsonb_build_object('err', SQLERRM));
END $$;
SELECT '4th tip in a day: tip_limit', coalesce((SELECT j ->> 'err' FROM r WHERE k = 'lim'), '') LIKE '%tip_limit%', coalesce((SELECT j::text FROM r WHERE k = 'lim'), 'no error');
-- (a) a second different user tips the same event (fuzzy title, +1 h) → the first turns ok, no duplicate
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970c');
INSERT INTO r SELECT 'c1', public.submit_event('PUBQUIZ – med Kalle!', (SELECT starts_at FROM public.bar_events WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1')) + interval '1 hour', 'of-pub-1', null, null, null, 'quiz', null);
SELECT 'second user, same event: answer ok + dup, the first tip id', j ->> 'status' = 'ok' AND (j ->> 'dup')::boolean AND j ->> 'id' = (SELECT j ->> 'id' FROM r WHERE k = 'a1'), j::text FROM r WHERE k = 'c1';
SELECT 'the first tip is ok now (confirmed)', status = 'ok' AND status_reason = 'confirmed', status || ' ' || coalesce(status_reason, '') FROM public.bar_events WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1');
SELECT 'no duplicate row', (SELECT count(*) FROM public.bar_events WHERE bar_id = 'of-pub-1' AND title ILIKE '%quiz%') = 1, '';
-- a different event at the same bar is NOT a match
UPDATE public.bar_events SET created_at = now() - interval '1 minute' WHERE created_by = '00000000-0000-4000-8000-00000004970c';
INSERT INTO r SELECT 'c2', public.submit_event('Karaoke', now() + interval '2 days', 'of-pub-1', null, null, null, 'other', null);
SELECT 'other title, same bar: no match (pending new_user)', j ->> 'status' = 'pending' AND NOT coalesce((j ->> 'dup')::boolean, false), j::text FROM r WHERE k = 'c2';
-- history trust: C gets an approved tip → the next one is ok at once
UPDATE public.bar_events SET status = 'ok', status_reason = 'owner', created_at = now() - interval '2 days' WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'c2');
INSERT INTO r SELECT 'c3', public.submit_event('Vinprovning', now() + interval '6 days', 'of-pub-1', null, null, null, 'other', null);
SELECT 'an earlier ok tip, none hidden: ok at once (auto:history)', j ->> 'status' = 'ok' AND j ->> 'reason' = 'auto:history', j::text FROM r WHERE k = 'c3';
-- (c) "Stämmer inte?": own event refused, 2 reports = still visible + reported, the 3rd hides it
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970b');
DO $$ BEGIN
  PERFORM public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1'));
EXCEPTION WHEN others THEN INSERT INTO r VALUES ('own', jsonb_build_object('err', SQLERRM)); END $$;
SELECT 'own event cannot be reported', coalesce((SELECT j ->> 'err' FROM r WHERE k = 'own'), '') LIKE '%own_event%', '';
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970d');
SELECT 'report 1', NOT (public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1')) ->> 'hidden')::boolean, '';
SELECT 'same reporter twice counts once', (public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1')) ->> 'n')::int = 1, '';
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970e');
SELECT 'report 2: still visible', NOT (public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1')) ->> 'hidden')::boolean, '';
SELECT 'reported ok event: reason reported (owner sees it)', status = 'ok' AND status_reason = 'reported', status || ' ' || status_reason FROM public.bar_events WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1');
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970f');
SELECT 'report 3 hides it', (public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1')) ->> 'hidden')::boolean, '';
SELECT 'status hidden, reason reports', status = 'hidden' AND status_reason = 'reports', status || ' ' || status_reason FROM public.bar_events WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'b1');
-- (e) 2 hidden tips in 30 days → pending-only, even with a saved account
INSERT INTO public.bar_events (source, title, kind, starts_at, bar_id, lat, lng, status, status_reason, status_at, created_by, expires_at, created_at)
SELECT 'user', 'Gammal ' || i, 'other', now() + interval '1 day', 'of-pub-1', 60.15, 15.18, 'hidden', 'owner', now() - interval '3 days',
       '00000000-0000-4000-8000-000000049710', now() + interval '2 days', now() - interval '4 days' FROM generate_series(1, 2) i;
SELECT pg_temp.as_u('00000000-0000-4000-8000-000000049710');
INSERT INTO r SELECT 'g1', public.submit_event('Quizkväll extra', now() + interval '8 days', 'of-pub-1', null, null, null, 'quiz', null);
SELECT '2 hidden tips in 30 days: pending-only (penalty)', j ->> 'status' = 'pending' AND j ->> 'reason' = 'penalty', j::text FROM r WHERE k = 'g1';
-- owner list: pending default holds the reason; owner_set_event marks owner
INSERT INTO public.owner_keys (key_hash) VALUES (encode(extensions.digest('of-test-key', 'sha256'), 'hex')) ON CONFLICT DO NOTHING;
WITH o AS (SELECT public.owner_events('of-test-key', 'pending') AS j)
SELECT 'owner pending list: pending tips with reason (new_user / not_bar / penalty), no ok ones', 
  (SELECT bool_and(x ->> 'status' = 'pending' AND x ? 'reason' AND x ? 'reports') AND count(*) >= 2 FROM o, jsonb_array_elements(o.j -> 'events') x WHERE x ->> 'title' NOT LIKE 'Gammal%'),
  (SELECT string_agg(x ->> 'title' || ':' || coalesce(x ->> 'reason', '-'), ', ') FROM o, jsonb_array_elements(o.j -> 'events') x);
SELECT pg_temp.as_u('00000000-0000-4000-8000-00000004970d');
SELECT public.report_event_tip((SELECT (j ->> 'id')::bigint FROM r WHERE k = 'c3'));
WITH o AS (SELECT public.owner_events('of-test-key', 'pending') AS j)
SELECT 'owner pending list also holds a reported ok event (reports = 1)', EXISTS (SELECT 1 FROM o, jsonb_array_elements(o.j -> 'events') x WHERE x ->> 'title' = 'Vinprovning' AND x ->> 'reason' = 'reported' AND (x ->> 'reports')::int = 1), '';
SELECT 'owner_set_event answers ok', (public.owner_set_event('of-test-key', (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1'), 'hidden') ->> 'ok')::boolean, '';
SELECT 'owner_set_event marks the reason owner', status = 'hidden' AND status_reason = 'owner', status || ' ' || status_reason FROM public.bar_events WHERE id = (SELECT (j ->> 'id')::bigint FROM r WHERE k = 'a1');
SELECT 'no CR in the new functions', position(chr(13) in pg_get_functiondef('public.submit_event(text,timestamptz,text,text,double precision,double precision,text,text)'::regprocedure)
  || pg_get_functiondef('public.report_event_tip(bigint)'::regprocedure)) = 0, '';
SELECT 'grants: report_event_tip for authenticated, helpers not',
  has_function_privilege('authenticated', 'public.report_event_tip(bigint)', 'execute') AND NOT has_function_privilege('authenticated', 'public.olnu_ev_tip_trust(uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'public.report_event_tip(bigint)', 'execute'), '';
SELECT 'submit_event grant kept', has_function_privilege('authenticated', 'public.submit_event(text,timestamptz,text,text,double precision,double precision,text,text)', 'execute'), '';
ROLLBACK;
