-- public.duel_answer(p_duel_id bigint, p_accept boolean)
-- live md5(pg_get_functiondef) = 7d73e1d89c21358e50a02403a171a4b6
CREATE OR REPLACE FUNCTION public.duel_answer(p_duel_id bigint, p_accept boolean)
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
  if not found or not public.olnu_wd_member(d.group_b, v_uid) then raise exception 'duel_not_found'; end if;
  perform public.olnu_duel_finish(d.id);
  select * into d from public.duels x where x.id = p_duel_id;
  if d.status <> 'pending' then
    if d.status = 'active' then return public.olnu_duel_json(d.id, v_uid); end if;
    raise exception 'duel_over';
  end if;
  if coalesce(p_accept, false) then
    update public.duels x set status = 'active', accepted_at = now(), answered_by = v_uid where x.id = d.id and x.status = 'pending';
  else
    update public.duels x set status = 'declined', answered_by = v_uid where x.id = d.id and x.status = 'pending';
  end if;
  return public.olnu_duel_json(d.id, v_uid);
end; $function$;
