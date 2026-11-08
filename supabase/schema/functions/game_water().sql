-- public.game_water()
-- live md5(pg_get_functiondef) = d7ea2c2a7b905b19cb5a8d207ac5b4b2
CREATE OR REPLACE FUNCTION public.game_water()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_water(v_uid, now()); end; $function$;
