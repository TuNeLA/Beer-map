-- public.olnu_crew_town_groups(p_key text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 59a046f811eb3bb146278a6da578b79d
CREATE OR REPLACE FUNCTION public.olnu_crew_town_groups(p_key text, p_lat double precision, p_lng double precision)
 RETURNS TABLE(group_id uuid, n integer, bar_id text, bar_name text, bar_lat double precision, bar_lng double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with raw as (
    select c.user_id as u, c.lat, c.lng, c.bar_id as bid, c.bar_name as bname,
           coalesce(bl.lat, c.lat) as blat, coalesce(bl.lng, c.lng) as blng, c.created_at as at
      from public.checkins c left join public.bars_lite bl on bl.id = c.bar_id
     where c.expires_at > now() and c.created_at > now() - interval '3 hours'
       and abs(c.lat - p_lat) < 0.6 and abs(c.lng - p_lng) < 1.2
    union all
    select b.user_id, b.lat, b.lng, b.snap_bar, bl.name,
           case when b.snap_bar is not null then coalesce(bl.lat, b.snap_lat) end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.snap_lng) end,
           greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b left join public.bars_lite bl on bl.id = b.snap_bar
     where b.expires_at > now() and not b.stopped and not b.ghost
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
       and abs(b.lat - p_lat) < 0.6 and abs(b.lng - p_lng) < 1.2
  ), pres as (
    select distinct on (r.u) r.* from raw r order by r.u, r.at desc
  ), ok as (
    select p.* from pres p
     where (select t.key from public.olnu_crew_town(p.lat, p.lng) t) = p_key
       and not exists (select 1 from public.crew_byes y where y.user_id = p.u and y.night = v_night
                         and y.cleared_at is null and y.at >= p.at)
       and not exists (select 1 from public.after_nights an where an.user_id = p.u and an.night = v_night
                         and an.home_at is not null and an.home_at >= p.at)
  ), gm as (
    select m.group_id as g, ok.* from ok join public.group_members m on m.user_id = ok.u
  ), cnt as (
    select gm.g, count(distinct gm.u)::int as n from gm group by gm.g
  ), bars as (
    select gm.g, gm.bid, max(gm.bname) as bname, max(gm.blat) as blat, max(gm.blng) as blng,
           count(distinct gm.u) as c, max(gm.at) as mat
      from gm where gm.bid is not null and gm.blat is not null group by gm.g, gm.bid
  ), best as (
    select distinct on (b.g) b.* from bars b order by b.g, b.c desc, b.mat desc
  )
  select cnt.g, cnt.n, best.bid, best.bname, best.blat, best.blng
    from cnt left join best on best.g = cnt.g;
end; $function$;
