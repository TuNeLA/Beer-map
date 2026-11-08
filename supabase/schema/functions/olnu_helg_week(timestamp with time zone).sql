-- public.olnu_helg_week(p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = b1e46167ef5cbe1df08ec90541822fb5
CREATE OR REPLACE FUNCTION public.olnu_helg_week(p_now timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select date_trunc('week', public.olnu_evening(public.olnu_night_of(p_now))::timestamp)::date;
$function$;
