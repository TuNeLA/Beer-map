-- public.olnu_night_of(p timestamp with time zone)
-- live md5(pg_get_functiondef) = 27d323a976af716a789e26ef28120be3
CREATE OR REPLACE FUNCTION public.olnu_night_of(p timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when (p at time zone 'Europe/Stockholm') >= date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours'
      then (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '29 hours') at time zone 'Europe/Stockholm'
    else (date_trunc('day', p at time zone 'Europe/Stockholm') + interval '5 hours') at time zone 'Europe/Stockholm'
  end;
$function$;
