-- public.duel_cancel(p_duel_id bigint)
-- live md5(pg_get_functiondef) = eb2d3b088ad85afec03b920e5f3d6995
CREATE OR REPLACE FUNCTION public.duel_cancel(p_duel_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  d public.duels;
begin
  select * into d from public.duels x where x.id = p_duel_id;
  if not found or not public.olnu_wd_member(d.group_a, v_uid) then raise exception 'duel_not_found'; end if;
  if d.status <> 'pending' then raise exception 'duel_over'; end if;
  update public.duels x set status = 'cancelled', answered_by = v_uid where x.id = d.id and x.status = 'pending';
  return jsonb_build_object('ok', true);
end; $function$;
