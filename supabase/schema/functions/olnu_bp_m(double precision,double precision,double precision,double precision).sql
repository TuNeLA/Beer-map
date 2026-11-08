-- public.olnu_bp_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
-- live md5(pg_get_functiondef) = fb1276088f052a9e7d7ae6c5ca9947f3
CREATE OR REPLACE FUNCTION public.olnu_bp_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 6371000 * 2 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) +
         cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))));
$function$;
