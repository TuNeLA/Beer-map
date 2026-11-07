-- 0187 🎯 LEK in event groups + store-safe missions (games3, owner 2026-11-07). Additive, safe to run again, no row removed.
-- 1. olnu_g_member (0017) also accepts the people of an event group (olnu_evg_member, 0166: creator + ✅ + 🤔 while the event
--    is open). So game_group (Kvällsbingo card, Krogrunda) and tick_bingo work in an event group. Sugen lists / tick names
--    there come from the new evg_lek(), because olnu_g_group reads names from group_members.
-- 2. evg_lek(p_group_id) → {night, people:[{k, name, is_me, status, at, out}], ticks:[{idx, name, is_me}]} for event people only.
-- 3. Store-safe (store-premium-plan.md: no rewards for drinking more): the mission kinds 'early' (first beer before 20:00),
--    'other_none' (only beer all night) and 'beer_type' (different beer types) are no longer handed out (active = false).
--    Missions already given tonight stay. Needs 0017, 0166.

create or replace function public.olnu_g_member(p_group uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
      or public.olnu_evg_member(p_group, p_uid);
$$;

create or replace function public.evg_lek(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v_night timestamptz := public.olnu_night_of(now());
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_evg_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  return jsonb_build_object('night', v_night,
    'people', coalesce((select jsonb_agg(jsonb_build_object('k', public.olnu_g_key(p_group_id, e.user_id), 'name', e.name,
                 'is_me', e.user_id = v_uid, 'status', s.status, 'at', s.updated_at,
                 'out', public.olnu_g_live(e.user_id, v_night, now())) order by s.updated_at desc nulls last, e.ord)
               from public.olnu_evg_people(p_group_id) e
               left join public.game_sugen s on s.user_id = e.user_id and s.night = v_night and s.status <> 'none'), '[]'::jsonb),
    'ticks', coalesce((select jsonb_agg(jsonb_build_object('idx', t.idx, 'name', coalesce(e.name, '?'), 'is_me', t.user_id = v_uid) order by t.idx)
               from public.game_bingo_ticks t left join public.olnu_evg_people(p_group_id) e on e.user_id = t.user_id
              where t.group_id = p_group_id and t.night = v_night and t.ticked), '[]'::jsonb));
end; $$;
revoke all on function public.evg_lek(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.evg_lek(uuid) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'grant execute on function public.evg_lek(uuid) to authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.evg_lek(uuid) to service_role'; end if;
end $$;

update public.game_mission_cat set active = false where kind in ('early', 'other_none', 'beer_type') and active;
