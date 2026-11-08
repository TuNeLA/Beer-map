-- public.olnu_bp_in_sweden(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 54f6a08ae74c582be3736022cc1ea236
CREATE OR REPLACE FUNCTION public.olnu_bp_in_sweden(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_lat is not null and p_lng is not null
     and p_lat not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lng not in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     and p_lat between -85.0 and 85.0 and p_lng between -180.0 and 180.0;
$function$;
