-- public.olnu_cer_night(p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = fa756f233daf372ba3daeedf26f99d9b
CREATE OR REPLACE FUNCTION public.olnu_cer_night(p_now timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.olnu_night_of(public.olnu_night_of(p_now) - interval '26 hours');
$function$;
