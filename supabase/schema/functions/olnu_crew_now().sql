-- public.olnu_crew_now()
-- live md5(pg_get_functiondef) = 409bc41fd63658bc227a0448eb1e7b29
CREATE OR REPLACE FUNCTION public.olnu_crew_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(current_setting('olnu.crew_now', true), '')::timestamptz, now());
$function$;
