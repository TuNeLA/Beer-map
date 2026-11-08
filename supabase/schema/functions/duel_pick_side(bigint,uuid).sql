-- public.duel_pick_side(p_duel_id bigint, p_group_id uuid)
-- live md5(pg_get_functiondef) = 310fd50658d349fec5663956cfb00b51
CREATE OR REPLACE FUNCTION public.duel_pick_side(p_duel_id bigint, p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  d public.duels;
  s public.duel_sides;
  v_side text;
begin
  select * into d from public.duels x where x.id = p_duel_id;
  if not found or not (public.olnu_wd_member(d.group_a, v_uid) or public.olnu_wd_member(d.group_b, v_uid)) then
    raise exception 'duel_not_found';
  end if;
  if not (public.olnu_wd_member(d.group_a, v_uid) and public.olnu_wd_member(d.group_b, v_uid)) then raise exception 'not_both'; end if;
  if d.ends_at <= now() or d.status not in ('pending', 'active') then raise exception 'duel_over'; end if;
  v_side := case when p_group_id = d.group_a then 'a' when p_group_id = d.group_b then 'b' end;
  if v_side is null then raise exception 'invalid_side'; end if;
  perform public.olnu_wd_rl('side:' || d.id::text || ':' || v_uid::text);
  select * into s from public.duel_sides x where x.duel_id = d.id and x.user_id = v_uid;
  if not found then
    insert into public.duel_sides (duel_id, user_id, side) values (d.id, v_uid, v_side);
  elsif s.side <> v_side then
    if s.changes > 0 or s.first_at <= now() - interval '10 minutes' then raise exception 'side_locked'; end if;
    update public.duel_sides x set side = v_side, changes = x.changes + 1, changed_at = now()
     where x.duel_id = d.id and x.user_id = v_uid;
  end if;
  return public.olnu_duel_json(d.id, v_uid);
end; $function$;
