-- public.olnu_world_ok(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 309906c0dc423d93d2af8f1acf8c43b8
CREATE OR REPLACE FUNCTION public.olnu_world_ok(p_lat double precision, p_lng double precision)
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
