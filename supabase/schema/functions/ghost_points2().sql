-- public.ghost_points2()
-- live md5(pg_get_functiondef) = e875db4f9f30878d5ea65f3998cb19f0
CREATE OR REPLACE FUNCTION public.ghost_points2()
 RETURNS TABLE(lat double precision, lng double precision, w double precision, age_h double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.olnu_uid();
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn,
           avg(extract(epoch from (now() - e.created_at)) / 3600.0) as ah
      from public.beer_events e
     where e.kind = 'beer'
       and not e.undone
       and e.hlat is not null
       and e.created_at >= now() - interval '3 days'
       and e.created_at <  now() - interval '1 day'
     group by e.hlat, e.hlng, e.hkind
  )
  select x.slat, x.slng, sum(x.cn)::float8 as cw, round((sum(x.cn * x.ah) / sum(x.cn))::numeric, 1)::float8 as cage
    from (select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
                 case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
                 c.cn, c.ah
            from cells c) x
   group by x.slat, x.slng
   order by cw desc
   limit 5000;
end;
$function$;
