-- public.olnu_evening(p_night timestamp with time zone)
-- live md5(pg_get_functiondef) = 425248259f560837881e0c5e90dfc13f
CREATE OR REPLACE FUNCTION public.olnu_evening(p_night timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ((p_night at time zone 'Europe/Stockholm') - interval '6 hours')::date;
$function$;
