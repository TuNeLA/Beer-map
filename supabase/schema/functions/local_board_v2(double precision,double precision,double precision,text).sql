-- public.local_board_v2(p_lat double precision, p_lng double precision, p_km double precision, p_period text)
-- live md5(pg_get_functiondef) = dbe00cc7ecfaaf2154f0fc5c28922105
CREATE OR REPLACE FUNCTION public.local_board_v2(p_lat double precision, p_lng double precision, p_km double precision DEFAULT 20, p_period text DEFAULT 'tonight'::text)
 RETURNS TABLE(rank integer, name text, total integer, nights integer, is_me boolean, home_town text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid    uuid := public.olnu_uid();
  v_period text := lower(btrim(coalesce(p_period, 'tonight')));
  v_km     float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat    float8;
  v_lng    float8;
  v_dlat   float8;
  v_week   date := public.olnu_week_start(now());
begin
  if not public.olnu_world_ok(p_lat, p_lng) then
    raise exception 'outside_sweden';
  end if;
  if v_period not in ('tonight', 'week') then
    raise exception 'invalid_period';
  end if;
  perform public.olnu_board_rl(v_uid);
  v_lat := round(p_lat::numeric, 2)::float8;
  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;

  return query
  with src as (
    select b.user_id as uid, (b.beer_count + coalesce(b.other_count, 0))::int as d, 1 as nn
      from public.beers b
     where v_period = 'tonight'
       and b.expires_at > now() and not coalesce(b.ghost, false)
       and b.beer_count + coalesce(b.other_count, 0) > 0
       and b.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, b.lat, b.lng) <= v_km * 1000
    union all
    select n.user_id, sum(n.drinks)::int, count(*)::int
      from public.board_nights n
     where v_period = 'week'
       and n.drinks > 0
       and public.olnu_evening(n.night) >= v_week
       and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(v_lat, v_lng, n.lat, n.lng) <= v_km * 1000
     group by n.user_id
  ),
  ranked as (
    select s.uid, s.d, s.nn,
           rank() over (order by s.d desc, s.nn desc)::int as rk,
           row_number() over (order by s.d desc, s.nn desc, s.uid)::int as rn
      from src s
  ),
  named as (
    select r.*, public.olnu_board_name(r.uid) as nm from ranked r where r.rn <= 10 or r.uid = v_uid
  )
  select x.rk, x.nm, x.d, x.nn, x.uid = v_uid,
         case when x.nm is not null then public.olnu_home_town(x.uid) end
    from named x
   order by x.rn;
end; $function$;
