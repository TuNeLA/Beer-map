-- 0525 · PN_SYNC (lane srvsync, PLAN A7, 19 Nov 2026). Coordinator-run: staging first, then live. ONE file, no other file needed.
-- Why: a phone sends its background reads (poll_v2 + the module polls) as rpc_bundle2. On live, rpc_bundle2 is the 0297
--   version (cap 24, no poll_v2, no start-up reads): those go alone, so one map poll = 2-6 requests, and every answer is
--   sent in full every 30 s, also when nothing changed.
-- What: public.pn_sync(p_calls, p_have) = rpc_bundle2 with VERSIONS.
--   p_calls = [{k, n, a}] like rpc_bundle2 (k = the client key, n = the function name, a = the named arguments). Cap 40.
--   p_have  = {k: hash} or {k: {field: hash}}: what the phone has from its last answer of that key.
--   Answer  = {"pn": 1, "r": {k: entry}}. entry is one of:
--     {"e": {"message", "code"}}                      the call failed (same as rpc_bundle2)
--     {"s": 1}                                        same as what the phone has: nothing is sent
--     {"d": value, "h": "hash"}                       a value that is not an object (array, number, text), in full
--     {"d": object, "h": {field: hash}}               an object, in full (the phone had no field hashes for this key)
--     {"d": changed fields, "h": {field: hash}, "p": 1}  an object: ONLY the fields that changed. h names every field
--                                                     of the new answer (a field that is not in h is not there any more).
--   The hash is the first 12 (field) or 16 (whole) characters of md5 of the jsonb text. jsonb text has a fixed key order,
--   so the same value gives the same hash.
-- Server list: the names come from public.rpc_bundle_allow (the 0500 table). This file makes the table and its 75 rows if
--   they are not there (live has no 0500 yet), with the same text as 0500, so 0500 can still run after this file.
--   pn_sync never calls itself or rpc_bundle2. It does not change rpc_bundle2.
-- Security: SECURITY INVOKER, like rpc_bundle2: each function runs as the caller, with its own auth.uid() checks.
--   pn_sync itself needs a signed-in caller (auth.uid()). Execute: authenticated only (not public, not anon).
-- Client: docs/js/app-net.js syncSend(). A server without this function answers PGRST202: the phone goes back to
--   rpc_bundle2 (today's path) and remembers that for 6 hours.
-- Additive: CREATE TABLE IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING, CREATE OR REPLACE FUNCTION, REVOKE / GRANT.
-- Safe to run many times.
-- Check after the run (expect t, t, t, t):
--   select to_regprocedure('public.pn_sync(jsonb,jsonb)') is not null,
--          (select count(*) from public.rpc_bundle_allow) >= 75,
--          has_function_privilege('authenticated', 'public.pn_sync(jsonb,jsonb)', 'execute'),
--          not has_function_privilege('anon', 'public.pn_sync(jsonb,jsonb)', 'execute');

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

-- one answer -> its entry for the phone (see the header). Pure: no table, no auth.
create or replace function public.olnu_sync_entry(p_v jsonb, p_have jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $fn$
declare v_hs jsonb; v_d jsonb; v_h text; v_n int;
begin
  if jsonb_typeof(p_v) = 'object' then
    select count(*)::int into v_n from jsonb_object_keys(p_v);
  end if;
  if jsonb_typeof(p_v) = 'object' and v_n <= 40 then
    select coalesce(jsonb_object_agg(e.key, left(md5(e.value::text), 12)), '{}'::jsonb) into v_hs from jsonb_each(p_v) e;
    if jsonb_typeof(p_have) = 'object' then
      if p_have = v_hs then return '{"s": 1}'::jsonb; end if;
      select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_d
        from jsonb_each(p_v) e where (p_have ->> e.key) is distinct from (v_hs ->> e.key);
      return jsonb_build_object('d', v_d, 'h', v_hs, 'p', 1);
    end if;
    return jsonb_build_object('d', p_v, 'h', v_hs);
  end if;
  v_h := left(md5(coalesce(p_v::text, 'null')), 16);
  if jsonb_typeof(p_have) = 'string' and (p_have #>> '{}') = v_h then return '{"s": 1}'::jsonb; end if;
  return jsonb_build_object('d', p_v, 'h', v_h);
end; $fn$;
revoke all on function public.olnu_sync_entry(jsonb, jsonb) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.olnu_sync_entry(jsonb, jsonb) from anon';
    execute 'grant execute on function public.olnu_sync_entry(jsonb, jsonb) to authenticated';
  end if;
end $g$;

create or replace function public.pn_sync(p_calls jsonb, p_have jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path to 'public' as $fn$
declare
  c jsonb; k text; n text; a jsonb; v jsonb; f record; arg text; i int; args text; ty text;
  v_have jsonb := coalesce(p_have, '{}'::jsonb);
  v_out jsonb := '{}'::jsonb;
  ok text[];
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_calls is null or jsonb_typeof(p_calls) <> 'array' or jsonb_array_length(p_calls) > 40 then raise exception 'invalid_calls'; end if;
  if jsonb_typeof(v_have) <> 'object' or length(v_have::text) > 65536 then v_have := '{}'::jsonb; end if;   -- odd p_have = full answers
  ok := public.olnu_bundle_allow();
  for c in select x from jsonb_array_elements(p_calls) x loop
    if jsonb_typeof(c) <> 'object' then continue; end if;
    k := left(coalesce(c->>'k', c->>'n', ''), 200); n := c->>'n'; a := coalesce(c->'a', '{}'::jsonb);
    if k = '' or v_out ? k then continue; end if;
    begin
      if n is null or n in ('pn_sync', 'rpc_bundle2') or not (n = any(ok)) or jsonb_typeof(a) <> 'object' then raise exception 'not_bundled'; end if;
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
      v_out := v_out || jsonb_build_object(k, public.olnu_sync_entry(v, v_have -> k));
    exception when others then
      v_out := v_out || jsonb_build_object(k, jsonb_build_object('e', jsonb_build_object('message', sqlerrm, 'code', sqlstate)));
    end;
  end loop;
  return jsonb_build_object('pn', 1, 'r', v_out);
end; $fn$;

revoke all on function public.pn_sync(jsonb, jsonb) from public;
do $g$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.pn_sync(jsonb, jsonb) from anon';
    execute 'grant execute on function public.pn_sync(jsonb, jsonb) to authenticated';
  end if;
end $g$;

select public.olnu_strip_cr();
