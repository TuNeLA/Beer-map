-- public.my_home_town()
-- live md5(pg_get_functiondef) = 1fa2a3a25c60386adeb240fe1c87c141
CREATE OR REPLACE FUNCTION public.my_home_town()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('town', public.olnu_home_town(v_uid));
end; $function$;
