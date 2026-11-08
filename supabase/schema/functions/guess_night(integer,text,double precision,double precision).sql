-- public.guess_night(p_guess integer, p_town text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = 251a24f79230dcc6eece1d764d1b40df
CREATE OR REPLACE FUNCTION public.guess_night(p_guess integer, p_town text, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_guess(v_uid, p_guess, p_town, p_lat, p_lng, now()); end; $function$;
