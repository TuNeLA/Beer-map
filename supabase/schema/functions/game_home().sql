-- public.game_home()
-- live md5(pg_get_functiondef) = e6b1d72e4e471f99fc85b40dc7c7ba6d
CREATE OR REPLACE FUNCTION public.game_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin return public.olnu_g_home(v_uid, now()); end; $function$;
