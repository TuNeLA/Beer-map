-- public.olnu_in_se_box(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 656b923ce2627281e1706fd7c983e0ff
CREATE OR REPLACE FUNCTION public.olnu_in_se_box(p_lat double precision, p_lng double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_lat between 55.0 and 69.1 and p_lng between 10.9 and 24.2;
$function$;
