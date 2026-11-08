-- public.olnu_skal_win_from(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = d9fb8249c11475624d18e574cdd64c74
CREATE OR REPLACE FUNCTION public.olnu_skal_win_from(p_night timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ((public.olnu_evening(p_night) + time '20:00') at time zone 'Europe/Stockholm');
$function$;
