-- public.wall_of_fame(p_lat double precision, p_lng double precision, p_km double precision)
-- live md5(pg_get_functiondef) = 6ab8d97430c8ae654acaf0853660798d
CREATE OR REPLACE FUNCTION public.wall_of_fame(p_lat double precision, p_lng double precision, p_km double precision DEFAULT 20)
 RETURNS TABLE(category text, name text, value integer, is_me boolean, top boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid  uuid := public.olnu_uid();
  v_km   float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat  float8;
  v_lng  float8;
  v_dlat float8;
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with nights as (
    select n.user_id as uid, n.night, n.drinks, n.updated_at
      from public.board_nights n
     where n.drinks > 0
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
  ),
  bars as (
    select x.bar_id from (
      select bl.id as bar_id, bl.lat, bl.lng from public.bars_lite bl
       where bl.lat between v_lat - v_dlat and v_lat + v_dlat
      union
      select bb.bar_id, bb.lat, bb.lng from public.board_bars bb
       where bb.lat between v_lat - v_dlat and v_lat + v_dlat
         and not exists (select 1 from public.bars_lite b2 where b2.id = bb.bar_id)
    ) x
     where public.olnu_dist_m(v_lat, v_lng, x.lat, x.lng) <= v_km * 1000
  ),
  visits as (
    select c.user_id as uid, c.bar_id, c.night from public.medal_checkins c join bars on bars.bar_id = c.bar_id
  ),
  vals as (
    select 'best_night'::text as cat, x.uid, x.drinks::int as v, x.updated_at as at
      from (select distinct on (ni.uid) ni.uid, ni.drinks, ni.updated_at
              from nights ni order by ni.uid, ni.drinks desc, ni.updated_at) x
    union all
    select 'nights', ni.uid, count(*)::int, max(ni.night) from nights ni group by ni.uid
    union all
    select 'bars', vi.uid, count(distinct vi.bar_id)::int, max(vi.night) from visits vi group by vi.uid
    union all
    select 'stammis', s.uid, max(s.k)::int, max(s.last) from (
      select vi.uid, vi.bar_id, count(distinct vi.night) as k, max(vi.night) as last
        from visits vi group by vi.uid, vi.bar_id) s group by s.uid
    union all
    select 'skal', ni.uid, sum(coalesce(an.skal_given, 0))::int, max(ni.night)
      from nights ni join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
    union all
    select 'home', ni.uid,
           count(*) filter (where coalesce(mn.home, false) or an.home_at is not null)::int, max(ni.night)
      from nights ni
      left join public.medal_nights mn on mn.user_id = ni.uid and mn.night = ni.night
      left join public.after_nights an on an.user_id = ni.uid and an.night = ni.night
     group by ni.uid
  ),
  ranked as (
    select va.cat, va.uid, va.v,
           row_number() over (partition by va.cat order by va.v desc, va.at asc nulls last, va.uid) as rn
      from vals va where va.v > 0
  )
  select r.cat, public.olnu_board_name(r.uid), r.v, r.uid = v_uid, r.rn = 1
    from ranked r
   where r.rn = 1 or r.uid = v_uid
   order by array_position(array['best_night', 'nights', 'bars', 'stammis', 'skal', 'home'], r.cat), r.rn;
end; $function$;
