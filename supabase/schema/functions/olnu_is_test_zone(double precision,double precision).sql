-- public.olnu_is_test_zone(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 4fe0b97b4d5cb68e51c7ff3c90296f0c
CREATE OR REPLACE FUNCTION public.olnu_is_test_zone(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(p_lat between 68.25 and 68.45 and p_lng between 18.60 and 19.00, false);
$function$;
