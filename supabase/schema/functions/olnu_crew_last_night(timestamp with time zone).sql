-- public.olnu_crew_last_night(p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = facd68e85f1176059f7122a538ccbdcc
CREATE OR REPLACE FUNCTION public.olnu_crew_last_night(p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.olnu_night_of(public.olnu_night_of(p_now) - interval '26 hours');
$function$;
