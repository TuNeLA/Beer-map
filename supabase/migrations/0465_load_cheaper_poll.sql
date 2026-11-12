-- 0465 LOAD · CHEAPER POLL (X10 load test, lane perf). OWNER-RUN. Additive: no statement removes rows or objects.
-- Why: on the staging project (Free plan, Nano compute) the app broke between ~16 and 50 active users.
-- The SQL in each RPC is cheap: 0.5–24 ms per call when the server is idle. The cost is the NUMBER OF HTTP REQUESTS.
-- Each request is one JWT check, one PostgREST transaction and one pool slot (10 slots on Nano). One open app sent
-- about 7 requests a minute, and a cold start sent about 45 requests in 5 s.
-- This file lets the client (app.js, lane perf) send fewer requests:
--   A. rpc_bundle2 accepts poll_v2 and the start-up calls (flags, config, my_*, the morning report; 2 small own-row writes:
--      mark_seen, walk_timer_tick), and up to 40 calls (was 24).
--      Then one map poll = 1 request (was 2–3), and a cold start = ~10 requests (was ~45).
--      Old clients do not change. A name that is not on the list still answers 'not_bundled', as before.
--      The new client works before this file runs too: it sends a name the server refuses alone (= today's calls).
--   B. poll_v2 check-ins: the "mine / in the map box / a group-mate" filter now runs BEFORE the per-row friend, block and
--      visibility checks. Before, it ran after them: every poll checked every live check-in in the country.
--      The answer is the same: the same filter is still the last condition, and the new one is wider than it
--      (a group-mate with a name is a group-mate). Only with more than 2000 live check-ins in the world the new
--      list can be longer (the 2000 limit now counts only the check-ins this map can show).
-- Method: the same anchor patch as 0149, 0403 and 0431. It reads the DEPLOYED definition and makes exact text replacements.
-- Each anchor must occur exactly once, or the patch stops with an error and nothing changes. A function that already
-- has the marker 'load0465' is skipped, so the file is safe to run twice.
-- Checked on a local copy (schema snapshot + migrations to 0453, Postgres 16): both anchors occur once; all 39 new names
-- exist, have one signature and are executable by authenticated; poll_v2 gives the same answer before and after
-- (supabase/tests/load-0465.test.sql).
-- Order: run it after 0430/0431 (sec). Those patch poll_v2 with other anchors; this file does not touch them.
-- Check after the run (expect t, t):
--   select position('load0465' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0,
--          position('load0465' in pg_get_functiondef('public.poll_v2(float8,float8,float8,float8,timestamptz,boolean)'::regprocedure)) > 0;

create or replace function public.olnu_load_patch(p_fn regprocedure, p_old text[], p_new text[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_def text := replace(pg_get_functiondef(p_fn), chr(13), '');   -- CR-safe (0501, like 0436 olnu_sec_patch)
  i int; n int;
begin
  p_old := array(select replace(x, chr(13), '') from unnest(p_old) with ordinality u(x, o) order by o);
  p_new := array(select replace(x, chr(13), '') from unnest(p_new) with ordinality u(x, o) order by o);
  if position('load0465' in v_def) > 0 then return 'skip ' || p_fn::text; end if;
  for i in 1 .. coalesce(array_length(p_old, 1), 0) loop
    n := (length(v_def) - length(replace(v_def, p_old[i], ''))) / greatest(length(p_old[i]), 1);
    if n <> 1 then
      raise exception 'olnu_load_patch %: anchor % found % times', p_fn::text, i, n;
    end if;
    v_def := replace(v_def, p_old[i], p_new[i]);
  end loop;
  execute v_def;
  return 'ok ' || p_fn::text;
end $$;
revoke all on function public.olnu_load_patch(regprocedure, text[], text[]) from public, anon, authenticated;

-- A. rpc_bundle2: more names + 40 calls per bundle. (rpc_bundle2 is SECURITY INVOKER: grants and RLS stay the caller's.)
select public.olnu_load_patch('public.rpc_bundle2(jsonb)',
  array[$a$'ghost_points2', 'golden_horse'];$a$,
        $a$jsonb_array_length(p_calls) > 24$a$],
  array[$a$'ghost_points2', 'golden_horse',
                     /*load0465*/ 'poll_v2', 'account_config', 'public_config', 'after_flags_get',
                     'ride_flags_get', 'bold_flags_get', 'my_visibility', 'my_account_deletion', 'my_avatar', 'my_home_town',
                     'my_medals', 'my_passport', 'my_groups', 'party_mine', 'spel_mine', 'rnd_me', 'my_board_optin',
                     'bars_gone', 'guess_night_kind', 'my_removals', 'friend_suggest', 'my_wrapped', 'city_league',
                     'events_near', 'events_near2', 'bar_sport_near', 'my_past_events', 'user_places', 'group_now',
                     'group_msgs', 'drivers_for', 'friend_list', 'my_stats', 'my_friends', 'my_event_chats', 'mark_seen',
                     'walk_timer_tick', 'after_report2', 'my_night_report'];$a$,
        $a$jsonb_array_length(p_calls) > 40$a$]);

-- B. poll_v2: the check-in list is filtered to "mine, in the map box, or a group-mate" first, then the per-row checks run.
select public.olnu_load_patch('public.poll_v2(double precision, double precision, double precision, double precision, timestamp with time zone, boolean)',
  array[$a$where c0.expires_at > now() and (c0.user_id = v_uid or not public.olnu_is_test_zone(c0.lat, c0.lng) or (select public.olnu_is_test_user(v_uid)))$a$],
  array[$a$where c0.expires_at > now() and (c0.user_id = v_uid or not public.olnu_is_test_zone(c0.lat, c0.lng) or (select public.olnu_is_test_user(v_uid)))
                                and (c0.user_id = v_uid or (c0.lat between v_a and v_c and c0.lng between v_b and v_d)
                                     or exists (select 1 from public.group_members am0
                                                  join public.group_members cm0 on cm0.group_id = am0.group_id and cm0.user_id = v_uid
                                                 where am0.user_id = c0.user_id)) /*load0465*/$a$]);

-- 0466–0469: reserved for lane load/perf, not used. Possible next step: keep poll_v2 'live_total' (a count of all live
-- pins in the world on every poll) in a one-row table that pg_cron updates every 30 s.
