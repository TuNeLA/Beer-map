-- public.olnu_crew_pres(p_uid uuid)
-- live md5(pg_get_functiondef) = 4e7871686014b1e71b2aec1394ee32c5
CREATE OR REPLACE FUNCTION public.olnu_crew_pres(p_uid uuid)
 RETURNS TABLE(lat double precision, lng double precision, bar_id text, bar_name text, bar_lat double precision, bar_lng double precision, at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select x.lat, x.lng, x.bar_id, x.bar_name, x.bar_lat, x.bar_lng, x.at from (
    select c.lat, c.lng, c.bar_id, c.bar_name, coalesce(bl.lat, c.lat) as bar_lat, coalesce(bl.lng, c.lng) as bar_lng,
           c.created_at as at
      from public.checkins c left join public.bars_lite bl on bl.id = c.bar_id
     where c.user_id = p_uid and c.expires_at > now() and c.created_at > now() - interval '3 hours'
    union all
    select b.lat, b.lng, b.snap_bar, bl.name,
           case when b.snap_bar is not null then coalesce(bl.lat, b.snap_lat) end,
           case when b.snap_bar is not null then coalesce(bl.lng, b.snap_lng) end,
           greatest(b.beer_at, b.other_at, b.created_at)
      from public.beers b left join public.bars_lite bl on bl.id = b.snap_bar
     where b.user_id = p_uid and b.expires_at > now() and not b.stopped and not b.ghost
       and (coalesce(b.beer_count, 0) + coalesce(b.other_count, 0)) >= 1
  ) x order by x.at desc limit 1;
$function$;
