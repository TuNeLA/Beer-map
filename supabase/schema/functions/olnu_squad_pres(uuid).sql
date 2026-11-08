-- public.olnu_squad_pres(p_group uuid)
-- live md5(pg_get_functiondef) = eceb5b727a520feb0ef767aa2676b41e
CREATE OR REPLACE FUNCTION public.olnu_squad_pres(p_group uuid)
 RETURNS TABLE(uid uuid, lat double precision, lng double precision, bar_id text, bar_name text, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_night timestamptz := public.olnu_night_of(now());
begin
  return query
  with m as (select gm.user_id from public.group_members gm where gm.group_id = p_group),
  raw as (
    select c.user_id as u, coalesce(bl.lat, c.lat) as la, coalesce(bl.lng, c.lng) as ln, c.bar_id as bid,
           coalesce(bl.name, c.bar_name) as bname, c.created_at as t
      from public.checkins c join m on m.user_id = c.user_id
      left join public.bars_lite bl on bl.id = c.bar_id
     where c.expires_at > now() and c.created_at > now() - interval '3 hours'
    union all
    select b.user_id, case when b.snap_bar is not null then coalesce(bl.lat, b.lat) else b.lat end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.lng) else b.lng end,
           b.snap_bar, bl.name, greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b join m on m.user_id = b.user_id
      left join public.bars_lite bl on bl.id = b.snap_bar
     where b.expires_at > now() and not b.stopped and not coalesce(b.ghost, false) and b.precise
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
       and greatest(b.beer_at, b.other_at, b.created_at) > now() - interval '2 hours'
  ), pres as (
    select distinct on (r.u) r.* from raw r where r.la is not null and r.ln is not null order by r.u, r.t desc
  )
  select p.u, p.la, p.ln, p.bid, p.bname, p.t
    from pres p
   where not exists (select 1 from public.crew_byes y where y.user_id = p.u and y.night = v_night and y.cleared_at is null and y.at >= p.t)
     and not exists (select 1 from public.after_nights an where an.user_id = p.u and an.night = v_night and an.home_at >= p.t);
end; $function$;
