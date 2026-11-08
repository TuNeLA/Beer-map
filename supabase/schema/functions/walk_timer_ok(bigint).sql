-- public.walk_timer_ok(p_walk_id bigint)
-- live md5(pg_get_functiondef) = 849d174cbf3f0f07cfc62747b892f0c4
CREATE OR REPLACE FUNCTION public.walk_timer_ok(p_walk_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); t public.gw_walk_timers;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.gw_walk_timers x set ok_at = coalesce(x.ok_at, now()), updated_at = now()
   where x.walk_id = p_walk_id and x.user_id = v_uid returning * into t;
  if t.walk_id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true) || public.olnu_gw_walk_state(t);
end $function$;
