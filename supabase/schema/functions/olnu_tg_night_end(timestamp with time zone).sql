-- public.olnu_tg_night_end(p_at timestamp with time zone)
-- live md5(pg_get_functiondef) = 51a503aefa70e2a4b743885f2b7d228a
CREATE OR REPLACE FUNCTION public.olnu_tg_night_end(p_at timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case when (p_at at time zone 'Europe/Stockholm') >= date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '5 hours'
              then (date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '1 day 5 hours') at time zone 'Europe/Stockholm'
              else (date_trunc('day', p_at at time zone 'Europe/Stockholm') + interval '5 hours') at time zone 'Europe/Stockholm' end;
$function$;
