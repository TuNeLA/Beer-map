-- public.pickup_stop(p_id bigint)
-- live md5(pg_get_functiondef) = 8421cb9add2eef02446c839600240a68
CREATE OR REPLACE FUNCTION public.pickup_stop(p_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.pickup_reqs set ended_at = now(), end_reason = 'stop', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null and (p_id is null or id = p_id);
  return jsonb_build_object('ok', true);
end; $function$;
