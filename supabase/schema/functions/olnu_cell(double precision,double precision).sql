-- public.olnu_cell(p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = ed177b2c3810f4c43bc4b46d30cda64c
CREATE OR REPLACE FUNCTION public.olnu_cell(p_lat double precision, p_lng double precision)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case when p_lat is null or p_lng is null then null
    else ((round(p_lat::numeric * 2) / 2)::numeric(6, 1))::text || ':' || (round(p_lng::numeric)::int)::text end;
$function$;
