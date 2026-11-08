-- public.olnu_dist_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
-- live md5(pg_get_functiondef) = 7fddccc3c4445adf093e323129fd7e0e
CREATE OR REPLACE FUNCTION public.olnu_dist_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2) +
           cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$function$;
