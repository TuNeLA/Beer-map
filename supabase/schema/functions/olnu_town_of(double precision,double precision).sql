-- public.olnu_town_of(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 7764616cb0a5d9b748f3359bc7ecccf1
CREATE OR REPLACE FUNCTION public.olnu_town_of(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.name from public.olnu_towns t
   where p_lat is not null and p_lng is not null
     and abs(t.lat - p_lat) < 0.3 and abs(t.lng - p_lng) < 0.6
   order by (t.lat - p_lat) ^ 2 + ((t.lng - p_lng) * cos(radians(p_lat))) ^ 2
   limit 1;
$function$;
