-- 0500 · RPC_BUNDLE_ALLOW (A10, w1-server, 12 Nov 2026). OWNER-RUN on release day, AFTER 0465, 0466 and 0480.
-- Why: the list of functions that rpc_bundle2 may call lived in 2 places: in the client (docs/js/app-net.js BUNDLE,
-- BUNDLE_NEW, BUNDLE_66, LANE_N) and as text inside rpc_bundle2. Each new name needed an anchor patch of rpc_bundle2.
-- Now:
--   1. Table public.rpc_bundle_allow(name) = the server list. A new name = one INSERT line in a new migration.
--   2. public.olnu_bundle_allow() returns the list (SECURITY DEFINER: rpc_bundle2 is SECURITY INVOKER and the table has
--      RLS with no policy, like every table here).
--   3. rpc_bundle2: full CREATE OR REPLACE. The text is the definition after 0297 + 0465 + 0466 + 0480 (local copy,
--      pg_get_functiondef), with ONE change: the "ok" list reads public.olnu_bundle_allow(). Same signature, same
--      SECURITY INVOKER, same grants, same answer shape ({key: {d: …}} or {key: {e: {message, code}}}), same cap (40),
--      same "not_bundled" for a name that is not on the list. The 75 names below = the old list, 1:1.
--   CI (scripts/ci/bundle-allow.mjs): every client bundle name must be a row here; the rows must cover the old list.
-- The old markers (load0465, fixp0466, fixm0480) stay in a comment, so a 2nd run of 0465 / 0466 / 0480 says "skip".
-- Additive: CREATE TABLE IF NOT EXISTS, INSERT … ON CONFLICT DO NOTHING, CREATE OR REPLACE FUNCTION, REVOKE / GRANT.
-- No statement removes rows or objects. Safe to run many times.
-- Check after the run (expect t, t, t):
--   select position('bundle0500' in pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure)) > 0,
--          (select count(*) from public.rpc_bundle_allow) >= 75,
--          has_function_privilege('authenticated', 'public.rpc_bundle2(jsonb)', 'execute');

do $c$
declare v text;
begin
  if to_regprocedure('public.rpc_bundle2(jsonb)') is null then
    raise exception '0500 needs rpc_bundle2 (0297).';
  end if;
  v := pg_get_functiondef('public.rpc_bundle2(jsonb)'::regprocedure);
  if position('load0465' in v) = 0 or position('fixp0466' in v) = 0 or position('fixm0480' in v) = 0 then
    raise exception '0500 needs 0465, 0466 and 0480 first (rpc_bundle2 has not all 3 markers). Nothing changed.';
  end if;
end $c$;

create table if not exists public.rpc_bundle_allow (
  name text primary key
);
alter table public.rpc_bundle_allow enable row level security;
revoke all on table public.rpc_bundle_allow from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.rpc_bundle_allow from anon, authenticated';
  end if;
end $g$;

insert into public.rpc_bundle_allow (name) values
  ('zone_counts'), ('game_poll'), ('gang_poll'), ('skal_poll'), ('film_poll'), ('ceremony_poll'),
  ('walk_poll'), ('my_invites'), ('helg_state'), ('my_status'), ('my_inbox'), ('my_dms'),
  ('pickup_poll'), ('safety_state'), ('duel_poll'), ('knuff_inbox'), ('my_rallies'), ('bar_status'),
  ('medevac_checks'), ('group_etas'), ('beer_reactions'), ('crew_poll'), ('near_poll'), ('my_meriter'),
  ('avatars_for'), ('ikvall_status'), ('home_status'), ('friend_totals'), ('ghost_points2'), ('golden_horse'),
  ('poll_v2'), ('account_config'), ('public_config'), ('after_flags_get'), ('ride_flags_get'), ('bold_flags_get'),
  ('my_visibility'), ('my_account_deletion'), ('my_avatar'), ('my_home_town'), ('my_medals'), ('my_passport'),
  ('my_groups'), ('party_mine'), ('spel_mine'), ('rnd_me'), ('my_board_optin'), ('bars_gone'),
  ('guess_night_kind'), ('my_removals'), ('friend_suggest'), ('my_wrapped'), ('city_league'), ('events_near'),
  ('events_near2'), ('bar_sport_near'), ('my_past_events'), ('user_places'), ('group_now'), ('group_msgs'),
  ('drivers_for'), ('friend_list'), ('my_stats'), ('my_friends'), ('my_event_chats'), ('mark_seen'),
  ('walk_timer_tick'), ('after_report2'), ('my_night_report'), ('group_photos'), ('msg_reacts'), ('group_voices'),
  ('group_status_v3'), ('group_status_v2'), ('moments_poll')
on conflict (name) do nothing;

create or replace function public.olnu_bundle_allow()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(a.name order by a.name), '{}'::text[]) from public.rpc_bundle_allow a;
$$;
revoke all on function public.olnu_bundle_allow() from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_bundle_allow() from anon';
    execute 'grant execute on function public.olnu_bundle_allow() to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.olnu_bundle_allow() to service_role';
  end if;
end $g$;

CREATE OR REPLACE FUNCTION public.rpc_bundle2(p_calls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
declare
  c jsonb; k text; n text; a jsonb; v jsonb; f record; arg text; i int; args text; ty text;
  v_out jsonb := '{}'::jsonb;
  ok text[] := public.olnu_bundle_allow();   -- bundle0500: the names are rows of public.rpc_bundle_allow (the lists of /*load0465*/ /*fixp0466*/ /*fixm0480*/ are rows now)
begin
  if jsonb_typeof(p_calls) <> 'array' or jsonb_array_length(p_calls) > 40 then raise exception 'invalid_calls'; end if;
  for c in select x from jsonb_array_elements(p_calls) x loop
    k := left(coalesce(c->>'k', c->>'n', ''), 200); n := c->>'n'; a := coalesce(c->'a', '{}'::jsonb);
    if k = '' or v_out ? k then continue; end if;
    begin
      if n is null or not (n = any(ok)) or jsonb_typeof(a) <> 'object' then raise exception 'not_bundled'; end if;
      select p.oid, p.proargnames, p.proargtypes, p.pronargs, p.proretset into f
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
      if not found then raise exception 'Could not find the function public.%', n; end if;
      args := '';
      for arg in select jsonb_object_keys(a) loop
        i := array_position(f.proargnames[1:f.pronargs], arg);
        if i is null then raise exception 'not_bundled'; end if;
        ty := format_type(f.proargtypes[i - 1], null);
        args := args || case when args = '' then '' else ', ' end ||
                case when ty in ('jsonb', 'json') then format('%I => (%L::jsonb -> %L)::%s', arg, a::text, arg, ty)
                     else format('%I => (%L::jsonb ->> %L)::%s', arg, a::text, arg, ty) end;
      end loop;
      if f.proretset then
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I(%s) x', n, args) into v;
      else
        execute format('select to_jsonb(public.%I(%s))', n, args) into v;
      end if;
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('d', v));
    exception when others then
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('e', jsonb_build_object('message', sqlerrm, 'code', sqlstate)));
    end;
  end loop;
  return v_out;
end; $fn$;

revoke all on function public.rpc_bundle2(jsonb) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.rpc_bundle2(jsonb) from anon';
    execute 'grant execute on function public.rpc_bundle2(jsonb) to authenticated';
  end if;
end $g$;

select public.olnu_strip_cr() as functions_fixed;
