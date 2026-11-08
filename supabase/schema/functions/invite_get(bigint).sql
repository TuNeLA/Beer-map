-- public.invite_get(p_id bigint)
-- live md5(pg_get_functiondef) = d2633dd10ee4f2c483fc7f8fa991adf6
CREATE OR REPLACE FUNCTION public.invite_get(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.invite_people p where p.invite_id = p_id and p.user_id = v_uid) then
    raise exception 'invite_not_found';
  end if;
  return public.olnu_inv_json(p_id, v_uid, true);
end; $function$;
