-- public.invite_cancel(p_id bigint)
-- live md5(pg_get_functiondef) = 7e80edb0626b484977fe8fa8659be64f
CREATE OR REPLACE FUNCTION public.invite_cancel(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.invites set status = 'cancelled', updated_at = now()
   where id = p_id and creator = v_uid and status = 'open';
  if not found then raise exception 'invite_not_found'; end if;
  return public.olnu_inv_json(p_id, v_uid, true);
end; $function$;
