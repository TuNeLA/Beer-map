-- public.olnu_gang_last_night()
-- live md5(pg_get_functiondef) = 7a73846c11be91d19f9db05587ed658f
CREATE OR REPLACE FUNCTION public.olnu_gang_last_night()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ((public.olnu_night_of(now()) at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$function$;
