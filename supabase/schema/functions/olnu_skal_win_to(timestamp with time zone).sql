-- public.olnu_skal_win_to(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 1a44dd7a27eff8d583e914553696ef83
CREATE OR REPLACE FUNCTION public.olnu_skal_win_to(p_night timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (((public.olnu_evening(p_night) + 1) + time '01:00') at time zone 'Europe/Stockholm');
$function$;
