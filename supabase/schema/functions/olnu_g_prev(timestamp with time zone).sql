-- public.olnu_g_prev(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = faa3799aed27b4b93ad43d05e496c728
CREATE OR REPLACE FUNCTION public.olnu_g_prev(p_night timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ((p_night at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$function$;
