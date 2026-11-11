-- 0465 (lane perf): rpc_bundle2 takes poll_v2 + the start-up reads (cap 40); poll_v2 check-ins are filtered first.
-- LOCAL / staging copy only. One transaction, ROLLBACK at the end. Runs 0465 itself twice (2nd = skip).
-- Needs: the schema (+ migrations to 0453). Makes its own users, group and check-ins.
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0465_load_cheaper_poll.sql -f supabase/tests/load-0465.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
-- 1 me · 2 group-mate in the box · 3 stranger in the box · 4 stranger far away · 5 friends-only stranger in the box
-- 6 group-mate far away · 7 stranger in the box, display name only in another group
INSERT INTO auth.users (id, aud, role) SELECT ('00000000-0000-4000-8000-0000000465' || lpad(n::text, 2, '0'))::uuid, 'authenticated', 'authenticated'
  FROM generate_series(1, 7) n;
INSERT INTO public.groups (id, name, code, created_by) VALUES
  ('00000000-0000-4000-8000-0000000465a0', 'Perf 0465', 'PRF465', '00000000-0000-4000-8000-000000046501'),
  ('00000000-0000-4000-8000-0000000465b0', 'Perf other', 'PRF466', '00000000-0000-4000-8000-000000046507');
INSERT INTO public.group_members (group_id, user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000465a0', '00000000-0000-4000-8000-000000046501', 'Jag'),
  ('00000000-0000-4000-8000-0000000465a0', '00000000-0000-4000-8000-000000046502', 'Kompis'),
  ('00000000-0000-4000-8000-0000000465a0', '00000000-0000-4000-8000-000000046506', 'Långväga'),
  ('00000000-0000-4000-8000-0000000465b0', '00000000-0000-4000-8000-000000046507', 'Annan');
INSERT INTO public.olnu_visibility (user_id, friends_only) VALUES ('00000000-0000-4000-8000-000000046505', true);
INSERT INTO public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
SELECT ('00000000-0000-4000-8000-0000000465' || lpad(n::text, 2, '0'))::uuid, 'perf-bar-' || n, 'Perfbaren ' || n, x.lat, x.lng,
       now() - n * interval '7 minutes', now() + interval '3 hours'
  FROM (VALUES (1, 60.150, 15.185), (2, 60.151, 15.186), (3, 60.152, 15.184), (4, 55.605, 13.003), (5, 60.149, 15.187),
               (6, 67.855, 20.225), (7, 60.148, 15.183)) x(n, lat, lng);

CREATE OR REPLACE FUNCTION pg_temp.as_me() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000046501","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000046501', true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ci(p_heat boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (public.poll_v2(60.14, 15.17, 60.16, 15.20, null, p_heat)::jsonb) -> 'checkins';
$$;
CREATE OR REPLACE FUNCTION pg_temp.b(p_calls jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.rpc_bundle2(p_calls); $$;
-- in chunks of 20 (fits the old cap 24 too), answers merged
CREATE OR REPLACE FUNCTION pg_temp.b16(p_calls jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.rpc_bundle2(coalesce((SELECT jsonb_agg(e ORDER BY i) FROM jsonb_array_elements(p_calls) WITH ORDINALITY x(e, i) WHERE i <= 20), '[]'))
      || public.rpc_bundle2(coalesce((SELECT jsonb_agg(e ORDER BY i) FROM jsonb_array_elements(p_calls) WITH ORDINALITY x(e, i) WHERE i > 20), '[]'));
$$;
CREATE OR REPLACE FUNCTION pg_temp.calls(n int, fn text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('k', fn || i, 'n', fn, 'a', '{}'::jsonb)) FROM generate_series(1, n) i;
$$;
-- the start-up reads as app.js sends them (name + arguments)
CREATE OR REPLACE FUNCTION pg_temp.newcalls() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('k', n, 'n', n, 'a', a)) FROM (VALUES
    ('poll_v2', '{"p_min_lat":60.14,"p_min_lng":15.17,"p_max_lat":60.16,"p_max_lng":15.2,"p_since":null,"p_heat":false}'::jsonb),
    ('account_config', '{}'), ('public_config', '{}'), ('after_flags_get', '{}'), ('ride_flags_get', '{}'), ('bold_flags_get', '{}'),
    ('my_visibility', '{}'), ('my_account_deletion', '{}'), ('my_avatar', '{}'), ('my_home_town', '{}'), ('my_medals', '{}'),
    ('my_passport', '{}'), ('my_groups', '{}'), ('party_mine', '{}'), ('spel_mine', '{}'), ('rnd_me', '{}'), ('my_board_optin', '{}'),
    ('bars_gone', '{}'), ('guess_night_kind', '{}'), ('my_removals', '{}'), ('friend_suggest', '{}'),
    ('my_wrapped', '{"p_kind":"year","p_offset":0}'), ('city_league', '{"p_week_offset":0}'),
    ('events_near', '{"p_lat":60.1496,"p_lng":15.1878,"p_days":7}'), ('events_near2', '{"p_lat":60.1496,"p_lng":15.1878,"p_days":7}'),
    ('bar_sport_near', '{"p_lat":60.1496,"p_lng":15.1878}'), ('my_past_events', '{"p_limit":20}'), ('user_places', '{"p_lat":60.1496,"p_lng":15.1878}'),
    ('group_now', '{"p_group_id":"00000000-0000-4000-8000-0000000465a0"}'),
    ('group_msgs', '{"p_group_id":"00000000-0000-4000-8000-0000000465a0","p_after_id":0}'),
    ('drivers_for', '{"p_group_id":"00000000-0000-4000-8000-0000000465a0"}'), ('friend_list', '{"p_name":null}'),
    ('my_stats', '{}'), ('my_friends', '{"p_name":"Jag"}'), ('my_event_chats', '{"p_seen":{"1":5}}'), ('mark_seen', '{}'), ('walk_timer_tick', '{}'),
    ('after_report2', '{"p_group_id":"00000000-0000-4000-8000-0000000465a0","p_night":null}'), ('my_night_report', '{"p_last":true}')) x(n, a);
$$;
CREATE OR REPLACE FUNCTION pg_temp.err(r jsonb, msg text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(k, ',' ORDER BY k), '') FROM jsonb_each(r) e(k, v) WHERE v -> 'e' ->> 'message' ~ msg;
$$;
CREATE OR REPLACE FUNCTION pg_temp.try(p_calls jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.rpc_bundle2(p_calls); RETURN 'ok'; EXCEPTION WHEN others THEN RETURN sqlerrm; END $$;

SELECT pg_temp.as_me();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_before AS SELECT pg_temp.ci() AS c, pg_temp.ci(true) AS ch, pg_temp.b16(pg_temp.newcalls()) AS b;
-- before 0465
SELECT 'before_new_names_refused', pg_temp.err(b, 'not_bundled') = (SELECT string_agg(e ->> 'n', ',' ORDER BY e ->> 'n') FROM jsonb_array_elements(pg_temp.newcalls()) e),
       pg_temp.err(b, 'not_bundled') FROM t_before;
SELECT 'before_cap_24', pg_temp.try(pg_temp.calls(24, 'my_status')) = 'ok' AND pg_temp.try(pg_temp.calls(25, 'my_status')) = 'invalid_calls',
       pg_temp.try(pg_temp.calls(25, 'my_status'));
SELECT 'before_checkins_mine_mates_box', (SELECT string_agg(x ->> 'bar_id', ',' ORDER BY x ->> 'bar_id') FROM jsonb_array_elements(c) x) = 'perf-bar-1,perf-bar-2,perf-bar-3,perf-bar-6,perf-bar-7',
       (SELECT string_agg(x ->> 'bar_id', ',' ORDER BY x ->> 'bar_id') FROM jsonb_array_elements(c) x) FROM t_before;
RESET ROLE;

\i :mig
\i :mig

SELECT 'marker_rpc_bundle2', position('load0465' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
SELECT 'marker_poll_v2', position('load0465' in pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure)) > 0, '';
SELECT 'run_twice_skips', (SELECT public.olnu_load_patch('public.rpc_bundle2(jsonb)', array['x'], array['y'])) = 'skip rpc_bundle2(jsonb)', '';
SELECT 'helper_not_for_users', NOT has_function_privilege('authenticated', 'public.olnu_load_patch(regprocedure,text[],text[])', 'execute')
       AND NOT has_function_privilege('anon', 'public.olnu_load_patch(regprocedure,text[],text[])', 'execute'), '';
SELECT 'grants_kept', has_function_privilege('authenticated', 'public.rpc_bundle2(jsonb)', 'execute') AND NOT has_function_privilege('anon', 'public.rpc_bundle2(jsonb)', 'execute')
       AND has_function_privilege('authenticated', 'public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)', 'execute'), '';
SELECT 'still_security_invoker', NOT p.prosecdef, '' FROM pg_proc p WHERE p.oid = 'public.rpc_bundle2(jsonb)'::regprocedure;

SELECT pg_temp.as_me();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_after AS SELECT pg_temp.ci() AS c, pg_temp.ci(true) AS ch, pg_temp.b(pg_temp.newcalls()) AS b;
SELECT 'after_new_names_bundled', pg_temp.err(b, 'not_bundled') = '', pg_temp.err(b, 'not_bundled') FROM t_after;
SELECT 'after_new_names_no_error', NOT EXISTS (SELECT 1 FROM jsonb_each(b) e(k, v) WHERE v ? 'e'),
       coalesce((SELECT string_agg(k || '=' || (v -> 'e' ->> 'message'), '; ') FROM jsonb_each(b) e(k, v) WHERE v ? 'e'), '') FROM t_after;
SELECT 'after_39_names', (SELECT count(*) FROM jsonb_each(b)) = 39, (SELECT count(*) FROM jsonb_each(b))::text FROM t_after;
SELECT 'after_poll_v2_in_bundle_same', (b -> 'poll_v2' -> 'd' -> 'checkins') = c AND (b -> 'poll_v2' -> 'd' -> 'pins') IS NOT NULL, left((b -> 'poll_v2' -> 'd')::text, 120) FROM t_after;
SELECT 'after_cap_40', pg_temp.try(pg_temp.calls(40, 'my_status')) = 'ok' AND pg_temp.try(pg_temp.calls(41, 'my_status')) = 'invalid_calls',
       pg_temp.try(pg_temp.calls(41, 'my_status'));
SELECT 'after_old_names_still_ok', pg_temp.err(pg_temp.b(pg_temp.calls(2, 'my_status') || pg_temp.calls(1, 'game_poll')), '.') = '', '';
SELECT 'after_unknown_name_refused', pg_temp.err(pg_temp.b('[{"k":"x","n":"set_display_name","a":{"p_display_name":"Hack"}},{"k":"y","n":"my_status","a":{}}]'), 'not_bundled') = 'x', '';
SELECT 'after_wrong_arg_refused', pg_temp.err(pg_temp.b('[{"k":"x","n":"my_groups","a":{"p_evil":1}},{"k":"y","n":"my_status","a":{}}]'), 'not_bundled') = 'x', '';
-- B: same check-in answer (with and without heat)
SELECT 'after_checkins_same', a.c = b.c AND a.ch = b.ch, coalesce((SELECT string_agg(x ->> 'bar_id', ',' ORDER BY x ->> 'bar_id') FROM jsonb_array_elements(b.c) x), '')
  FROM t_before a, t_after b;
RESET ROLE;
-- B: the prefilter is in the inner check-in query (before the per-row checks), not only at the end
SELECT 'prefilter_inside', position('(c0.lat between v_a and v_c' in pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure))
       < position('left join lateral' in substr(pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure),
                  position('from public.checkins c0' in pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure))))
                  + position('from public.checkins c0' in pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure)), '';
ROLLBACK;
