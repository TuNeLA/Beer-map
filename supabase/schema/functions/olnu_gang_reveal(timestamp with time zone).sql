-- public.olnu_gang_reveal(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 55c35030afbe6614b5579a43db37bbc6
CREATE OR REPLACE FUNCTION public.olnu_gang_reveal(p_night timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (((p_night at time zone 'Europe/Stockholm')::date + time '10:00') at time zone 'Europe/Stockholm');
$function$;
