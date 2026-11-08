-- public.olnu_heat(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_limit integer)
-- live md5(pg_get_functiondef) = 94f9a55797ab9c37f9dd4ba620c45ab9
CREATE OR REPLACE FUNCTION public.olnu_heat(p_min_lat double precision, p_min_lng double precision, p_max_lat double precision, p_max_lng double precision, p_limit integer)
 RETURNS TABLE(lat double precision, lng double precision, w double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_box boolean := p_min_lat is not null and p_min_lng is not null and p_max_lat is not null and p_max_lng is not null;
begin
  return query
  with cells as (
    select e.hlat as clat, e.hlng as clng, e.hkind as k, count(*) as cn,
           sum(case when e.n >= 10 then 3 when e.n >= 5 then 2 else 1 end)::float8 as cw
      from public.beer_events e
     where e.expires_at > now() and e.kind = 'beer' and not e.undone and e.hlat is not null and (not public.olnu_is_test_zone(coalesce(e.lat, e.hlat), coalesce(e.lng, e.hlng)) or (select public.olnu_is_test_user(auth.uid())))
       and (not v_box or (e.hlat between p_min_lat - 0.0025 and p_max_lat + 0.0025
                          and e.hlng between p_min_lng - 0.005 and p_max_lng + 0.005))
     group by e.hlat, e.hlng, e.hkind
  ),
  shown as (
    -- k-anonymity: a ~55 m cell with fewer than 3 beers moves to its ~550 m grid point.
    select case when c.k = 2 and c.cn < 3 then round(c.clat * 200) / 200.0 else c.clat end as slat,
           case when c.k = 2 and c.cn < 3 then round(c.clng * 100) / 100.0 else c.clng end as slng,
           c.cw
      from cells c
  )
  select s.slat, s.slng, sum(s.cw)::float8 as sw
    from shown s
   where not v_box or (s.slat between p_min_lat and p_max_lat and s.slng between p_min_lng and p_max_lng)
   group by s.slat, s.slng
   order by sw desc, s.slat, s.slng
   limit greatest(1, least(coalesce(p_limit, 5000), 5000));
end;
$function$;
