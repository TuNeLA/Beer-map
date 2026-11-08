-- public.find_stop()
-- live md5(pg_get_functiondef) = 2b189d02d352f837e83ac9f7d62d1d79
CREATE OR REPLACE FUNCTION public.find_stop()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  update public.find_pos x set lat = null, lng = null, acc = null, target_uid = null, updated_at = now(), expires_at = now()
   where x.user_id = v_uid;
  return jsonb_build_object('ok', true);
end; $function$;
