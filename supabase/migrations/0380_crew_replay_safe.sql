-- 0380 (bold, owner OK 2026-11-08): Kvällsrepris privacy fix. crew_replay keeps its signature, grants and JSON shape,
-- but it returns only SAFE points (helper olnu_replay_safe_points):
--   1. A person with a ghost night (spökläge: drink_log.ghost, or the night's beer row is ghost) is left out.
--   2. Bar points (kind 'ci', or a drink snapped to a bar) are kept exact. Bars are public places.
--   3. Non-bar points before the person's first bar point (pre-party) and after the last bar point (the way home) are
--      removed. A person without a bar point has no safe point.
--   4. Non-bar points between bars are rounded to a ~500 m grid (lat 0.0045, lng 0.009 at 60° N).
--   5. Any kept point (bar or not) within 400 m of a removed point is removed too (homes near a bar).
-- The trail so ends at the last bar: nothing after it, and never the last 200 m to a home.
-- Summary numbers are made from the safe points only. Additive: create or replace, no data change.

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
  ), raw as (
    select x.id, x.user_id, x.at, x.kind, x.bar_id, x.bar_name, x.lat, x.lng,
           (x.kind = 'ci' or x.bar_id is not null) as is_bar
      from public.crew_tracks x join mem on mem.uid = x.user_id
     where x.night = p_night and x.lat is not null and x.lng is not null
  ), win as (
    select r.user_id, min(r.at) filter (where r.is_bar) as f_at, max(r.at) filter (where r.is_bar) as l_at
      from raw r group by r.user_id
  ), lab as (
    select r.*, (w.f_at is null or (not r.is_bar and (r.at < w.f_at or r.at > w.l_at))) as is_cut,
           case when r.is_bar then r.lat else (round(r.lat::numeric / 0.0045) * 0.0045)::float8 end as s_lat,
           case when r.is_bar then r.lng else (round(r.lng::numeric / 0.009) * 0.009)::float8 end as s_lng
      from raw r join win w on w.user_id = r.user_id
  )
  select k.user_id, k.id, k.at, k.kind, k.bar_id, k.bar_name, k.s_lat, k.s_lng
    from lab k
   where not k.is_cut
     and not exists (select 1 from lab d where d.user_id = k.user_id and d.is_cut
                       and (public.olnu_dist_m(k.lat, k.lng, d.lat, d.lng) <= 400
                            or public.olnu_dist_m(k.s_lat, k.s_lng, d.lat, d.lng) <= 400));
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
    'top_bar', (select y.bar_name from jsonb_to_recordset(v_safe) as y(user_id uuid, id bigint, at timestamptz, kind text, bar_id text, bar_name text, lat double precision, lng double precision) where y.bar_name is not null
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
