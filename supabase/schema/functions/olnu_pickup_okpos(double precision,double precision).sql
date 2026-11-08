-- public.olnu_pickup_okpos(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 467b778799dcca9a5c5b9ef5f5401def
CREATE OR REPLACE FUNCTION public.olnu_pickup_okpos(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_lat is not null and p_lng is not null and p_lat = p_lat and p_lng = p_lng and abs(p_lat) <= 85 and abs(p_lng) <= 180;
$function$;
