-- public.olnu_helg_now()
-- live md5(pg_get_functiondef) = cfdcd297799ec286376fd043774e81e6
CREATE OR REPLACE FUNCTION public.olnu_helg_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(current_setting('olnu.helg_now', true), '')::timestamptz, now());
$function$;
