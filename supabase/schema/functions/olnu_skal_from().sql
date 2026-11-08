-- public.olnu_skal_from()
-- live md5(pg_get_functiondef) = 13a310d6935c1f5f92da00aee7450c3a
CREATE OR REPLACE FUNCTION public.olnu_skal_from()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$function$;
