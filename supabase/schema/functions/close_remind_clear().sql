-- public.close_remind_clear()
-- live md5(pg_get_functiondef) = e8fb35a052c60a6f7e9a1576310b375c
CREATE OR REPLACE FUNCTION public.close_remind_clear()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.close_reminders set sent20 = true, sent10 = true, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', true);
end; $function$;
