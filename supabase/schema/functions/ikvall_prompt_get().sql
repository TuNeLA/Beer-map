-- public.ikvall_prompt_get()
-- live md5(pg_get_functiondef) = 5b3f844aebbbf5a01b5fb1395e110a5a
CREATE OR REPLACE FUNCTION public.ikvall_prompt_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object('v', 1, 'on', coalesce((select p.enabled from public.ikvall_prompt p where p.user_id = v_uid), false));
end $function$;
