-- public.olnu_week_start(p timestamp with time zone)
-- live md5(pg_get_functiondef) = 6035ec47766aa53d292a4e53d4633be9
CREATE OR REPLACE FUNCTION public.olnu_week_start(p timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select date_trunc('week', p at time zone 'Europe/Stockholm')::date;
$function$;
