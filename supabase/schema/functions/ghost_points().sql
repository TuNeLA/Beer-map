-- public.ghost_points()
-- live md5(pg_get_functiondef) = 995bfbbe8cfe28e6ff3d49238f42d9d0
CREATE OR REPLACE FUNCTION public.ghost_points()
 RETURNS TABLE(lat double precision, lng double precision, w double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_uid();
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn
      from public.beer_events e
     where e.kind = 'beer'
       and not e.undone
       and e.hlat is not null
       and e.created_at >= now() - interval '3 days'
       and e.created_at <  now() - interval '1 day'
       and (not public.olnu_is_test_zone(coalesce(e.lat, e.hlat), coalesce(e.lng, e.hlng)) or (select public.olnu_is_test_user(auth.uid())))
     group by e.hlat, e.hlng, e.hkind
  )
  select x.slat, x.slng, sum(x.cn)::float8 as cw
    from (select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
                 case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
                 c.cn
            from cells c) x
   group by x.slat, x.slng
   order by cw desc
   limit 5000;
end;
$function$;
