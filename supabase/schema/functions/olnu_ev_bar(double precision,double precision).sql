-- public.olnu_ev_bar(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 6235d5ebc89e1cf1ad3caa4a536a9b47
CREATE OR REPLACE FUNCTION public.olnu_ev_bar(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select b.id from public.bars_lite b
   where b.active and b.type in ('bar', 'pub', 'nightclub', 'biergarten', 'restaurant')
     and b.lat between p_lat - 0.001 and p_lat + 0.001 and b.lng between p_lng - 0.002 and p_lng + 0.002
     and (power((b.lat - p_lat) * 111320, 2) + power((b.lng - p_lng) * 111320 * cos(radians(p_lat)), 2)) <= 75 * 75
   order by power(b.lat - p_lat, 2) + power((b.lng - p_lng) * cos(radians(p_lat)), 2) limit 1;
$function$;
