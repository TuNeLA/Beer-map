-- public.rnd_me()
-- live md5(pg_get_functiondef) = c28427c49701911df03023bf67d2daed
CREATE OR REPLACE FUNCTION public.rnd_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  return jsonb_build_object('number', (select s.number from public.rnd_swish s where s.user_id = v_uid));
end; $function$;
