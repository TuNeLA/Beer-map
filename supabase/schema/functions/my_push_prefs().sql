-- public.my_push_prefs()
-- live md5(pg_get_functiondef) = 50dcc612f86b7b0ca395e59456f25d57
CREATE OR REPLACE FUNCTION public.my_push_prefs()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return public.olnu_push_prefs_of(v_uid);
end $function$;
