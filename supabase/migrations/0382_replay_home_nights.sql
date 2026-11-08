-- 0382 (bold, owner 2026-11-08): Kvällsrepris for home nights too, still safe. Replaces the 0380 rule (same names,
-- same signature, same grants, same JSON shape of crew_replay).
--   1. A night with no bar point still gets a replay.
--   2. A home / non-bar START or END of the night is ONE fuzzy stop: the first (or last) raw point snapped to the ~500 m grid
--      (lat 0.0045, lng 0.009), kind 'area', bar_name '🏠 Förfest' (start) or '🏠 Hemma' (end, or a night spent near the
--      start). Never the exact spot. The client draws it as a soft ~250 m circle, not a pin.
--   3. Other non-bar points (moving between stops) are snapped to the same grid.
--   4. Every raw non-bar point within 400 m of the start or end point is removed (replaced by the fuzzy stop).
--   5. Bar points (check-in, or a drink snapped to a bar) stay exact: bars are public places.
--   6. Ghost nights are left out. "Ta bort mig från reprisen": table bold_replay_hide + RPC bold_replay_hide_me.
-- Additive: create table if not exists + create or replace. No data change.

create table if not exists public.bold_replay_hide (
  group_id   uuid not null,
  user_id    uuid not null,
  night      timestamptz not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, night)
);
alter table public.bold_replay_hide enable row level security;
revoke all on table public.bold_replay_hide from public, anon, authenticated;

create or replace function public.olnu_replay_safe_points(p_group_id uuid, p_night timestamptz)
returns table (user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mem as (
    select m.user_id as uid from public.group_members m
     where m.group_id = p_group_id
       and not exists (select 1 from public.drink_log d where d.user_id = m.user_id and d.night = p_night and coalesce(d.ghost, false))
       and not exists (select 1 from public.beers b where b.user_id = m.user_id and b.expires_at = p_night
                        and (coalesce(b.ghost, false) or coalesce(b.prev_ghost, false)))
       and not exists (select 1 from public.bold_replay_hide h where h.group_id = p_group_id and h.user_id = m.user_id and h.night = p_night and h.active)
  ), raw as (
    select x.id, x.user_id, x.at, x.kind, x.bar_id, x.bar_name, x.lat, x.lng,
           (x.kind = 'ci' or x.bar_id is not null) as is_bar,
           row_number() over (partition by x.user_id order by x.at, x.id) as rf,
           row_number() over (partition by x.user_id order by x.at desc, x.id desc) as rl
      from public.crew_tracks x join mem on mem.uid = x.user_id
     where x.night = p_night and x.lat is not null and x.lng is not null
  ), ends as (
    select f.user_id, f.id as f_id, f.at as f_at, f.lat as f_lat, f.lng as f_lng, not f.is_bar as f_home,
           l.id as l_id, l.at as l_at, l.lat as l_lat, l.lng as l_lng, not l.is_bar as l_home
      from raw f join raw l on l.user_id = f.user_id and l.rl = 1
     where f.rf = 1
  ), lab as (
    select r.*, e.f_home, e.l_home,
           (not r.is_bar and (
              (e.f_home and (public.olnu_dist_m(r.lat, r.lng, e.f_lat, e.f_lng) <= 400
                             or public.olnu_dist_m((round(r.lat::numeric / 0.0045) * 0.0045)::float8, (round(r.lng::numeric / 0.009) * 0.009)::float8, e.f_lat, e.f_lng) <= 400))
           or (e.l_home and (public.olnu_dist_m(r.lat, r.lng, e.l_lat, e.l_lng) <= 400
                             or public.olnu_dist_m((round(r.lat::numeric / 0.0045) * 0.0045)::float8, (round(r.lng::numeric / 0.009) * 0.009)::float8, e.l_lat, e.l_lng) <= 400)))) as is_cut
      from raw r join ends e on e.user_id = r.user_id
  ), stay as (   -- the whole night near the start = a home night
    select e.user_id, not exists (select 1 from raw r where r.user_id = e.user_id
                                   and public.olnu_dist_m(r.lat, r.lng, e.f_lat, e.f_lng) > 400) as home_night
      from ends e
  )
  select k.user_id, k.id, k.at, k.kind, k.bar_id, k.bar_name,
         case when k.is_bar then k.lat else (round(k.lat::numeric / 0.0045) * 0.0045)::float8 end,
         case when k.is_bar then k.lng else (round(k.lng::numeric / 0.009) * 0.009)::float8 end
    from lab k
   where not k.is_cut
  union all
  select e.user_id, e.f_id, e.f_at, 'area', null::text,
         case when s.home_night then '🏠 Hemma' else '🏠 Förfest' end,
         (round(e.f_lat::numeric / 0.0045) * 0.0045)::float8, (round(e.f_lng::numeric / 0.009) * 0.009)::float8
    from ends e join stay s on s.user_id = e.user_id
   where e.f_home
  union all
  select e.user_id, e.l_id, e.l_at, 'area', null::text, '🏠 Hemma',
         (round(e.l_lat::numeric / 0.0045) * 0.0045)::float8, (round(e.l_lng::numeric / 0.009) * 0.009)::float8
    from ends e
   where e.l_home and e.l_id <> e.f_id;
$function$;

revoke all on function public.olnu_replay_safe_points(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.crew_replay(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_now timestamptz := public.olnu_crew_now();
  v_last timestamptz := public.olnu_crew_last_night(v_now);
  v_pts jsonb; v_mem jsonb; v_sum jsonb; v_safe jsonb;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_now >= v_last + interval '13 hours' then
    return jsonb_build_object('available', false, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_safe
    from public.olnu_replay_safe_points(p_group_id, v_last) q;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, t.user_id), 'at', t.at,
           'lat', t.lat, 'lng', t.lng, 'bar_name', t.bar_name, 'kind', t.kind) order by t.at, t.id), '[]'::jsonb)
    into v_pts
    from (select s.* from jsonb_to_recordset(v_safe) as s(user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision) order by s.at, s.id limit 1500) t;
  if jsonb_array_length(v_pts) = 0 then
    return jsonb_build_object('available', false, 'empty', true, 'opens_at', public.olnu_night_of(v_now));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_crew_k(p_group_id, m.user_id), 'name', m.display_name,
           'is_me', m.user_id = v_uid,
           'home_at', (select an.home_at from public.after_nights an where an.user_id = m.user_id and an.night = v_last),
           'bye_at', (select y.at from public.crew_byes y where y.user_id = m.user_id and y.night = v_last and y.cleared_at is null))
           order by m.joined_at), '[]'::jsonb)
    into v_mem from public.group_members m
   where m.group_id = p_group_id
     and exists (select 1 from jsonb_to_recordset(v_safe) as s(user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision) where s.user_id = m.user_id);
  select jsonb_build_object(
    'members_out', count(distinct x.user_id),
    'bars', count(distinct x.bar_id) filter (where x.bar_id is not null),
    'checkins', count(*) filter (where x.kind = 'ci'),
    'points', count(*),
    'first_at', min(x.at), 'last_at', max(x.at),
    'top_bar', (select y.bar_name from jsonb_to_recordset(v_safe) as y(user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision)
                 where y.bar_name is not null and y.kind <> 'area'
                 group by y.bar_name order by count(distinct y.user_id) desc, count(*) desc limit 1),
    'torch', (select count(*) from public.crew_torch_hops h join public.crew_torches tt on tt.id = h.torch_id
               where h.to_group = p_group_id and tt.night = v_last))
    into v_sum
    from jsonb_to_recordset(v_safe) as x(user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision);
  return jsonb_build_object('available', true, 'night', v_last, 'evening', public.olnu_evening(v_last),
    'members', v_mem, 'points', v_pts, 'summary', v_sum);
end; $function$;

revoke all on function public.crew_replay(uuid) from public, anon;
grant execute on function public.crew_replay(uuid) to authenticated, service_role;

-- "Ta bort mig från reprisen": hides (p_on = true) or shows again (false) MY trail in this group's replay of last night.
create or replace function public.bold_replay_hide_me(p_group_id uuid, p_on boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_last timestamptz := public.olnu_crew_last_night(public.olnu_crew_now());
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  insert into public.bold_replay_hide as h (group_id, user_id, night, active) values (p_group_id, v_uid, v_last, coalesce(p_on, true))
  on conflict (group_id, user_id, night) do update set active = excluded.active;
  return jsonb_build_object('v', 1, 'hidden', coalesce(p_on, true), 'night', v_last);
end; $function$;

revoke all on function public.bold_replay_hide_me(uuid, boolean) from public, anon;
grant execute on function public.bold_replay_hide_me(uuid, boolean) to authenticated, service_role;
