-- 0500 (w1-server, A10): rpc_bundle2 reads its name list from public.rpc_bundle_allow. Same answers as before.
-- LOCAL / CI copy only. One transaction, ROLLBACK at the end. Runs 0500 itself twice (2nd = no change).
-- Needs: a database with 0465, 0466, 0480 and WITHOUT 0500 (scripts/ci/sql-rehearsal.mjs --pre 0500 makes rh_pre).
-- usage: psql "$DB" -X -v ON_ERROR_STOP=1 -v mig=supabase/migrations/0500_rpc_bundle_allow.sql -f supabase/tests/rpc-bundle-allow-0500.test.sql
-- Prints "name|ok|detail" lines; any "|f|" = fail.
\pset format unaligned
\pset tuples_only on
BEGIN;
INSERT INTO auth.users (id, aud, role) VALUES ('00000000-0000-4000-8000-000000050001', 'authenticated', 'authenticated');
CREATE FUNCTION public.w1_bundle_probe() RETURNS integer LANGUAGE sql STABLE AS 'select 42';
GRANT EXECUTE ON FUNCTION public.w1_bundle_probe() TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_me() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000050001","role":"authenticated","is_anonymous":true}', true);
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000050001', true);
END $$;
-- every name of the old list (no arguments: a name that needs one answers the same error before and after)
-- + 2 names that are not on the list + the probe
CREATE OR REPLACE FUNCTION pg_temp.calls(p_part int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('k', n, 'n', n, 'a', '{}'::jsonb) ORDER BY o)
    FROM unnest(array['zone_counts','game_poll','gang_poll','skal_poll','film_poll','ceremony_poll','walk_poll','my_invites',
      'helg_state','my_status','my_inbox','my_dms','pickup_poll','safety_state','duel_poll','knuff_inbox','my_rallies','bar_status',
      'medevac_checks','group_etas','beer_reactions','crew_poll','near_poll','my_meriter','avatars_for','ikvall_status',
      'home_status','friend_totals','ghost_points2','golden_horse','poll_v2','account_config','public_config','after_flags_get',
      'ride_flags_get','bold_flags_get','my_visibility','my_account_deletion','my_avatar','my_home_town','my_medals',
      'my_passport','my_groups','party_mine','spel_mine','rnd_me','my_board_optin','bars_gone','guess_night_kind',
      'my_removals','friend_suggest','my_wrapped','city_league','events_near','events_near2','bar_sport_near',
      'my_past_events','user_places','group_now','group_msgs','drivers_for','friend_list','my_stats','my_friends',
      'my_event_chats','walk_timer_tick','after_report2','my_night_report','group_photos','msg_reacts',
      'group_voices','group_status_v3','group_status_v2','moments_poll',
      'set_display_name','owner_kpi','w1_bundle_probe']) WITH ORDINALITY u(n, o)
   WHERE (o - 1) / 40 = p_part;   -- max 40 calls per bundle
$$;
CREATE OR REPLACE FUNCTION pg_temp.all_calls() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.rpc_bundle2(pg_temp.calls(0)) || public.rpc_bundle2(pg_temp.calls(1));
$$;
-- the answer without the values that may change between two calls (only "d" or the error message per key)
CREATE OR REPLACE FUNCTION pg_temp.shape(r jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(k, CASE WHEN v ? 'd' THEN to_jsonb('d'::text) ELSE v -> 'e' -> 'message' END) FROM jsonb_each(r) e(k, v);
$$;
CREATE OR REPLACE FUNCTION pg_temp.many(p int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('k', 'k' || g, 'n', 'my_status', 'a', '{}'::jsonb)) FROM generate_series(1, p) g;
$$;
CREATE OR REPLACE FUNCTION pg_temp.try(p_calls jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.rpc_bundle2(p_calls); RETURN 'ok'; EXCEPTION WHEN others THEN RETURN sqlerrm; END $$;

SELECT pg_temp.as_me();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_before AS SELECT pg_temp.all_calls() AS r;
SELECT 'before_probe_refused', r -> 'w1_bundle_probe' -> 'e' ->> 'message' = 'not_bundled', r -> 'w1_bundle_probe' FROM t_before;
RESET ROLE;

\i :mig
\i :mig

SELECT 'marker_bundle0500', position('bundle0500' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0, '';
SELECT 'rows_75', (SELECT count(*) FROM public.rpc_bundle_allow) = 75, (SELECT count(*) FROM public.rpc_bundle_allow)::text;
SELECT 'old_markers_kept_0465_skips', public.olnu_load_patch('public.rpc_bundle2(jsonb)', array['x'], array['y']) = 'skip rpc_bundle2(jsonb)', '';
SELECT 'old_markers_kept_0466_skips', public.olnu_fixp_patch('public.rpc_bundle2(jsonb)', '/*fixp0466*/', array['x'], array['y']) = 'skip rpc_bundle2(jsonb)', '';
SELECT 'old_markers_kept_0480_skips', public.olnu_fixm_patch('public.rpc_bundle2(jsonb)', '/*fixm0480*/', array['x'], array['y']) = 'skip rpc_bundle2(jsonb)', '';
SELECT 'still_security_invoker', NOT p.prosecdef, '' FROM pg_proc p WHERE p.oid = 'public.rpc_bundle2(jsonb)'::regprocedure;
SELECT 'grants_kept', has_function_privilege('authenticated', 'public.rpc_bundle2(jsonb)', 'execute')
       AND NOT has_function_privilege('anon', 'public.rpc_bundle2(jsonb)', 'execute'), '';
SELECT 'table_closed', NOT has_table_privilege('authenticated', 'public.rpc_bundle_allow', 'select')
       AND NOT has_table_privilege('anon', 'public.rpc_bundle_allow', 'select')
       AND NOT has_table_privilege('authenticated', 'public.rpc_bundle_allow', 'insert'), '';
SELECT 'list_fn_not_for_anon', NOT has_function_privilege('anon', 'public.olnu_bundle_allow()', 'execute')
       AND has_function_privilege('authenticated', 'public.olnu_bundle_allow()', 'execute'), '';
SELECT 'table_has_rls', c.relrowsecurity, '' FROM pg_class c WHERE c.oid = 'public.rpc_bundle_allow'::regclass;

SELECT pg_temp.as_me();
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t_after AS SELECT pg_temp.all_calls() AS r;
SELECT 'same_answers', pg_temp.shape(a.r) = pg_temp.shape(b.r),
       coalesce((SELECT string_agg(k, ',') FROM jsonb_each(pg_temp.shape(a.r)) e(k, v) WHERE pg_temp.shape(b.r) -> k IS DISTINCT FROM v), '')
  FROM t_before a, t_after b;
SELECT 'same_data_answers', (SELECT count(*) FROM jsonb_each(pg_temp.shape(b.r)) e(k, v) WHERE v = to_jsonb('d'::text)) > 20,
       (SELECT count(*) FROM jsonb_each(pg_temp.shape(b.r)) e(k, v) WHERE v = to_jsonb('d'::text))::text FROM t_after b;
SELECT 'unknown_refused', r -> 'set_display_name' -> 'e' ->> 'message' = 'not_bundled' AND r -> 'owner_kpi' -> 'e' ->> 'message' = 'not_bundled', '' FROM t_after;
SELECT 'cap_40', pg_temp.try(pg_temp.many(40)) = 'ok' AND pg_temp.try(pg_temp.many(41)) = 'invalid_calls', pg_temp.try(pg_temp.many(41));
SELECT 'user_cannot_add_a_name', pg_temp.try('[]') = 'ok' AND NOT has_table_privilege('public.rpc_bundle_allow', 'insert'), '';
RESET ROLE;

-- a new name = one row (no rpc_bundle2 change)
INSERT INTO public.rpc_bundle_allow (name) VALUES ('w1_bundle_probe');
SELECT pg_temp.as_me();
SET LOCAL ROLE authenticated;
SELECT 'new_row_bundles', (public.rpc_bundle2('[{"k":"p","n":"w1_bundle_probe","a":{}}]') -> 'p' ->> 'd') = '42',
       (public.rpc_bundle2('[{"k":"p","n":"w1_bundle_probe","a":{}}]'))::text;
RESET ROLE;
ROLLBACK;
