-- 0533 · My exact beer on my pin and on the ÖL! button (lane mybeer, owner I-146 + I-147, 22 Nov 2026). COORDINATOR-RUN, staging first.
-- What it adds (nothing existing changes; no function is replaced):
--   beers.beer_lib        text         the beer library id (EAN-like) of the beer I picked tonight, or null
--   beers.beer_lib_night  timestamptz  the night (beers.expires_at) it was set for: a beer never leaks into another night
--   set_beer_lib(p_beer text) -> {ok, beer}
--       The caller's OWN live pin row only (the row set_beer_type reads: user_id = auth.uid(), not expired, beer_count >= 1).
--       p_beer null = take it away. p_beer must match ^[0-9A-Za-z_-]{1,40}$ (olnu_bl_id_ok, 0526). No live row = 'no_beer'.
--   beer_lib_pins(p_ids jsonb) -> [{id, beer}]
--       The beer of pins the caller may see BY NAME (the "known" rule of olnu_pins / poll_v2): group mates' live pins.
--       (The caller's own pin is shown from the phone; it is in the answer too when asked for.)
--       The owner's beer privacy (beer_prefs.fav_mode, 0526, the same switch as the favourites): spoke = nobody,
--       vanner = only accepted friends, alla (default) = group mates. Never across a block (olnu_ub_hidden / olnu_dm_blocked),
--       never a stopped or ghost pin, never another night. A stranger's pin id is a rotating text ('p…') in poll_v2:
--       it is not a number, so it never matches here; a guessed real id of a stranger gives nothing (not a group mate).
--       p_ids is a JSON array of numbers (jsonb, so rpc_bundle2 can pass it), max 200; other entries are skipped.
--   rpc_bundle_allow row 'beer_lib_pins' (0500 table): the read rides the poll bundle (client docs/js/app-net.js BUNDLE).
-- Grants: execute for authenticated only (revoked from public and anon). Both are SECURITY DEFINER with a fixed search_path
-- and an auth.uid() check in the body. Table access to beers stays revoked from anon / authenticated (0001).
-- Old client: never calls these (nothing changes for it). New client + server without 0533: PGRST202 = the beer shows only on
-- the phone that picked it (one silent fall-back, no retries).
-- Personal data: the column lives on the night's pin row, so the existing end-of-night clean-up and the account erase of
-- public.beers (0016: the row is re-keyed and stopped) cover it; a stopped row is never answered.
-- Additive. Safe to run twice. CR LF safe. Needs: olnu_bl_id_ok + beer_prefs (0526), olnu_ub_hidden (0206), olnu_dm_blocked (0136),
--   olnu_are_friends (0045), group_members (0001), rpc_bundle_allow (0500), olnu_strip_cr (0436).
-- Check after the run (expect t, t, t, t, t, t, t):
--   select to_regprocedure('public.set_beer_lib(text)') is not null,
--     to_regprocedure('public.beer_lib_pins(jsonb)') is not null,
--     not has_function_privilege('anon', 'public.set_beer_lib(text)', 'execute'),
--     not has_function_privilege('anon', 'public.beer_lib_pins(jsonb)', 'execute'),
--     has_function_privilege('authenticated', 'public.beer_lib_pins(jsonb)', 'execute'),
--     exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'beers' and column_name = 'beer_lib_night'),
--     exists (select 1 from public.rpc_bundle_allow where name = 'beer_lib_pins');

alter table public.beers add column if not exists beer_lib text null;
alter table public.beers add column if not exists beer_lib_night timestamptz null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'beers_beer_lib_ok' and conrelid = 'public.beers'::regclass) then
    alter table public.beers add constraint beers_beer_lib_ok check (beer_lib is null or beer_lib ~ '^[0-9A-Za-z_-]{1,40}$') not valid;
  end if;
end $$;

-- set_beer_lib(p_beer) -> {ok, beer}. Only the caller's live pin row. null = take it away.
create or replace function public.set_beer_lib(p_beer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_beer text := nullif(btrim(coalesce(p_beer, '')), '');
  v_n int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_beer is not null and not public.olnu_bl_id_ok(v_beer) then raise exception 'invalid_beer'; end if;
  update public.beers b
     set beer_lib = v_beer, beer_lib_night = case when v_beer is null then null else b.expires_at end
   where b.user_id = v_uid and b.expires_at > now() and b.beer_count >= 1;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'no_beer'; end if;
  return jsonb_build_object('ok', true, 'beer', v_beer);
end;
$$;

-- beer_lib_pins(p_ids) -> [{id, beer}]: the exact beer of pins the caller may see by name (group mates), under the owner's
-- beer privacy. Read only.
create or replace function public.beer_lib_pins(p_ids jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids bigint[];
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then return '[]'::jsonb; end if;
  if jsonb_array_length(p_ids) > 200 then raise exception 'too_many'; end if;
  select coalesce(array_agg(distinct e.v::bigint), '{}'::bigint[]) into v_ids
    from jsonb_array_elements_text(p_ids) as e(v)
   where e.v ~ '^[0-9]{1,18}$';
  if cardinality(v_ids) = 0 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'beer', b.beer_lib) order by b.id)
      from public.beers b
     where b.id = any (v_ids)
       and b.beer_lib is not null
       and b.beer_lib_night = b.expires_at
       and b.expires_at > now()
       and not b.stopped
       and (b.user_id = v_uid or (
            exists (select 1 from public.group_members cm
                      join public.group_members am on am.group_id = cm.group_id
                     where cm.user_id = v_uid and am.user_id = b.user_id)
            and not public.olnu_ub_hidden(v_uid, b.user_id)
            and not public.olnu_dm_blocked(v_uid, b.user_id)
            and case coalesce((select p.fav_mode from public.beer_prefs p where p.user_id = b.user_id), 'alla')
                  when 'spoke' then false
                  when 'vanner' then public.olnu_are_friends(v_uid, b.user_id)
                  else true end))), '[]'::jsonb);
end;
$$;

revoke all on function public.set_beer_lib(text) from public;
revoke all on function public.set_beer_lib(text) from anon;
revoke all on function public.beer_lib_pins(jsonb) from public;
revoke all on function public.beer_lib_pins(jsonb) from anon;
grant execute on function public.set_beer_lib(text) to authenticated;
grant execute on function public.beer_lib_pins(jsonb) to authenticated;

insert into public.rpc_bundle_allow (name) values ('beer_lib_pins') on conflict do nothing;

select public.olnu_strip_cr();
