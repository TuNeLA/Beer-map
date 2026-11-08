-- public.spel_open(p_group_id uuid, p_game text)
-- live md5(pg_get_functiondef) = 2c5d2c89f57ae3c533f471ddbe0d5efd
CREATE OR REPLACE FUNCTION public.spel_open(p_group_id uuid, p_game text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.spel_rooms; v_name text; me public.spel_players; v_ord int;
begin
  if p_game is not null and p_game not in ('kort', 'vem', 'aldrig', 'hellre', 'quiz') then raise exception 'invalid_game'; end if;
  select public.olnu_party_name(m.display_name) into v_name from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid;
  if not found then
    if public.olnu_evg_member(p_group_id, v_uid) then v_name := public.olnu_party_name(public.olnu_friend_name(v_uid));
    else raise exception 'not_member'; end if;
  end if;
  if not public.olnu_party_lim(v_uid, 'spel_open', 60, interval '10 minutes') then raise exception 'slow_down'; end if;
  perform pg_advisory_xact_lock(hashtext('olnu-spel:' || p_group_id::text));
  select * into r from public.spel_rooms where group_id = p_group_id and not closed and expires_at > now() order by created_at desc limit 1 for update;
  if r.id is null then
    insert into public.spel_rooms (group_id, game, created_by) values (p_group_id, coalesce(p_game, 'kort'), v_uid) returning * into r;
  elsif p_game is not null and r.game <> p_game and r.phase in ('lobby', 'end') then
    update public.spel_rooms set game = p_game, phase = 'lobby', pub = '{}'::jsonb, v = v + 1, updated_at = now() where id = r.id returning * into r;
  end if;
  select * into me from public.spel_players where room_id = r.id and user_id = v_uid;
  if me.user_id is null then
    select coalesce(max(ord), 0) + 1 into v_ord from public.spel_players where room_id = r.id;
    insert into public.spel_players (room_id, user_id, k, name, ord) values (r.id, v_uid, public.olnu_spel_k(r.id, v_uid), coalesce(v_name, 'Soldat'), v_ord);
  elsif me.status <> 'in' or me.seen_at < now() - interval '10 seconds' or me.name <> coalesce(v_name, me.name) then
    update public.spel_players set status = 'in', seen_at = now(), name = coalesce(v_name, name) where room_id = r.id and user_id = v_uid;
  end if;
  if me.user_id is null or me.status <> 'in' then
    update public.spel_rooms set v = v + 1, expires_at = greatest(expires_at, now() + interval '2 hours') where id = r.id;
    if r.game = 'kort' and r.phase in ('pick', 'judge', 'result') then perform public.olnu_spel_deal(r.id); end if;
  end if;
  return public.olnu_spel_view(r.id, v_uid);
end; $function$;
