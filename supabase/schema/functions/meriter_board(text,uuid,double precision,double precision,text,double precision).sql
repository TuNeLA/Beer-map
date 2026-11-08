-- public.meriter_board(p_scope text, p_group_id uuid, p_lat double precision, p_lng double precision, p_period text, p_km double precision)
-- live md5(pg_get_functiondef) = 62740d1282d9063d691affb3b3f8ad60
CREATE OR REPLACE FUNCTION public.meriter_board(p_scope text DEFAULT 'group'::text, p_group_id uuid DEFAULT NULL::uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_period text DEFAULT 'week'::text, p_km double precision DEFAULT 20)
 RETURNS TABLE(rank integer, name text, meriter integer, title text, is_me boolean, home_town text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid    uuid := public.olnu_uid();
  v_scope  text := lower(btrim(coalesce(p_scope, 'group')));
  v_period text := lower(btrim(coalesce(p_period, 'week')));
  v_km     float8 := least(50, greatest(5, coalesce(nullif(p_km, 'NaN'::float8), 20)));
  v_lat    float8;
  v_lng    float8;
  v_dlat   float8;
  v_night  timestamptz := public.olnu_night_of(now());
  v_wstart timestamptz := ((public.olnu_week_start(now()) + interval '29 hours') at time zone 'Europe/Stockholm');
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_period not in ('tonight', 'week', 'all') then raise exception 'invalid_period'; end if;
  if v_scope not in ('group', 'town') then raise exception 'invalid_scope'; end if;
  perform public.olnu_board_rl(v_uid);
  if v_scope = 'group' then
    if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    return query
    with u as (
      select gm.user_id, gm.display_name as nm from public.group_members gm where gm.group_id = p_group_id
    ), v as (
      select u.user_id, u.nm,
             case when v_period = 'all' then public.olnu_meriter(u.user_id)
                  else coalesce((select sum(l.pts) from public.meriter_log l where l.user_id = u.user_id
                                  and l.night >= case when v_period = 'tonight' then v_night else v_wstart end), 0)::int end as m
        from u
    ), rk as (
      select v.*, rank() over (order by v.m desc)::int as rn, row_number() over (order by v.m desc, v.nm) as o from v
    )
    select rk.rn, rk.nm, rk.m, (select r.title from public.olnu_rank_of(public.olnu_meriter(rk.user_id)) r),
           rk.user_id = v_uid, public.olnu_home_town(rk.user_id)
      from rk where rk.o <= 20 or rk.user_id = v_uid order by rk.o;
    return;
  end if;
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  v_lat := round(p_lat::numeric, 2)::float8;  v_lng := round(p_lng::numeric, 2)::float8;
  v_dlat := v_km / 111.0;
  return query
  with near as (
    select distinct n.user_id from public.board_nights n
     where n.night > now() - interval '30 days' and n.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(n.lat, n.lng, v_lat, v_lng) <= v_km * 1000
    union
    select b.user_id from public.beers b
     where b.expires_at > now() and not coalesce(b.ghost, false) and b.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(b.lat, b.lng, v_lat, v_lng) <= v_km * 1000
    union
    select c.user_id from public.checkins c
     where c.expires_at > now() and c.lat between v_lat - v_dlat and v_lat + v_dlat
       and public.olnu_dist_m(c.lat, c.lng, v_lat, v_lng) <= v_km * 1000
    union
    select v_uid
  ), v as (
    select near.user_id,
           case when v_period = 'all' then public.olnu_meriter(near.user_id)
                else coalesce((select sum(l.pts) from public.meriter_log l where l.user_id = near.user_id
                                and l.night >= case when v_period = 'tonight' then v_night else v_wstart end), 0)::int end as m
      from near
  ), rk as (
    select v.*, rank() over (order by v.m desc)::int as rn, row_number() over (order by v.m desc, v.user_id) as o
      from v where v.m > 0 or v.user_id = v_uid
  )
  select rk.rn, public.olnu_board_name(rk.user_id), rk.m,
         (select r.title from public.olnu_rank_of(public.olnu_meriter(rk.user_id)) r),
         rk.user_id = v_uid,
         case when public.olnu_board_name(rk.user_id) is not null then public.olnu_home_town(rk.user_id) end
    from rk where rk.o <= 20 or rk.user_id = v_uid order by rk.o;
end; $function$;
