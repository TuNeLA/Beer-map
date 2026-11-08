-- public.party_act(p_room uuid, p_act text, p_val text, p_data jsonb)
-- live md5(pg_get_functiondef) = 894d5ef2b80f06a829f88594b351506f
CREATE OR REPLACE FUNCTION public.party_act(p_room uuid, p_act text, p_val text DEFAULT NULL::text, p_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); r public.party_rooms; me public.party_players; h public.party_players;
  v_can boolean; v_need uuid[]; v_val text; v_t uuid; v_n int; v_new uuid; v_fin jsonb;
begin
  if not public.olnu_party_lim(v_uid, 'act', 150, interval '1 minute') then raise exception 'slow_down'; end if;
  select * into r from public.party_rooms where id = p_room for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into me from public.party_players where room_id = p_room and user_id = v_uid;
  if me.user_id is null or me.status = 'left' then raise exception 'not_in_room'; end if;
  if r.closed or r.expires_at <= now() then raise exception 'room_closed'; end if;
  select * into h from public.party_players where room_id = p_room and user_id = r.host;
  v_can := me.is_host or h.user_id is null or h.status = 'left' or h.seen_at < now() - interval '45 seconds';
  update public.party_players set seen_at = now() where room_id = p_room and user_id = v_uid;

  if p_act in ('start', 'next', 'tovote', 'accept', 'all', 'lobby', 'game', 'kick') and not v_can then raise exception 'not_host'; end if;

  if p_act = 'start' then
    perform public.olnu_party_start(p_room, coalesce(p_data, '{}'::jsonb));
  elsif p_act = 'next' then
    perform public.olnu_party_next(p_room, true);
  elsif p_act = 'tovote' then
    if r.game <> 'imposter' or r.phase <> 'clue' then raise exception 'not_now'; end if;
    update public.party_rooms set phase = 'vote', v = v + 1, updated_at = now(),
           pub = pub || jsonb_build_object('rk', 'vote:' || coalesce(pub->>'cycle', '1'), 'turn_k', null, 'turn_name', null)
     where id = p_room;
  elsif p_act = 'accept' then
    if r.game <> 'imposter' or r.phase <> 'guessed' or coalesce((r.pub->>'guess_ok')::boolean, false)
       or coalesce(r.pub->>'guess', '') = '' then raise exception 'not_now'; end if;
    update public.party_rooms set v = v + 1, updated_at = now(),
           pub = pub || jsonb_build_object('guess_ok', true, 'accepted', true, 'after', 'end', 'win', 'imp')
     where id = p_room;
  elsif p_act = 'all' then
    if r.game <> 'hatten' or r.phase <> 'reveal' then raise exception 'not_now'; end if;
    update public.party_rooms set step = coalesce((pub->>'slip_n')::int, 0), v = v + 1, updated_at = now() where id = p_room;
  elsif p_act = 'lobby' then
    update public.party_players set status = case when status = 'left' then 'left' when status = 'tv' then 'tv' else 'in' end,
           in_game = false, out_round = null
     where room_id = p_room;
    update public.party_rooms set phase = 'lobby', pub = '{}'::jsonb, sec = '{}'::jsonb, round = 0, step = 0, v = v + 1, updated_at = now()
     where id = p_room;
  elsif p_act = 'game' then
    if r.phase not in ('lobby', 'end') then raise exception 'not_now'; end if;
    if p_val is null or p_val not in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen') then raise exception 'invalid_game'; end if;
    update public.party_players set status = case when status in ('left', 'tv') then status else 'in' end, in_game = false
     where room_id = p_room;
    update public.party_rooms set game = p_val, phase = 'lobby', pub = '{}'::jsonb, sec = '{}'::jsonb, v = v + 1, updated_at = now()
     where id = p_room;
  elsif p_act = 'kick' then
    v_t := public.olnu_party_uid(p_room, p_val);
    if v_t is null or v_t = v_uid or v_t = r.host then raise exception 'invalid_member'; end if;
    update public.party_players set status = 'left' where room_id = p_room and user_id = v_t;
    update public.party_rooms set v = v + 1, updated_at = now() where id = p_room;
    perform public.olnu_party_next(p_room, false);
  elsif p_act = 'close' then
    if not me.is_host then raise exception 'not_host'; end if;
    update public.party_rooms set closed = true, v = v + 1, updated_at = now() where id = p_room;
    return jsonb_build_object('closed', true, 'v', r.v + 1, 'id', r.id, 'code', r.code);
  elsif p_act = 'leave' then
    update public.party_players set status = 'left', is_host = false where room_id = p_room and user_id = v_uid;
    if me.is_host then
      select p.user_id into v_new from public.party_players p where p.room_id = p_room and p.status <> 'left'
       order by (p.status = 'tv'), p.seen_at desc, p.joined_at limit 1;
      if v_new is null then
        update public.party_rooms set closed = true, v = v + 1, updated_at = now() where id = p_room;
      else
        update public.party_players set is_host = true where room_id = p_room and user_id = v_new;
        update public.party_rooms set host = v_new, v = v + 1, updated_at = now() where id = p_room;
      end if;
    else
      update public.party_rooms set v = v + 1, updated_at = now() where id = p_room;
    end if;
    perform public.olnu_party_next(p_room, false);
    return jsonb_build_object('left', true, 'v', r.v + 1, 'id', r.id, 'code', r.code);
  elsif p_act = 'done' then
    if r.game = 'imposter' and r.phase = 'clue' and me.k = r.pub->>'turn_k' then
      perform public.olnu_party_next(p_room, true);
    elsif r.game = 'vagen' and r.phase = 'clue' and me.k = r.pub->>'psy_k' then
      perform public.olnu_party_next(p_room, true);
    else
      raise exception 'not_your_turn';
    end if;
  elsif p_act in ('ready', 'vote', 'answer', 'best', 'slide', 'guess') then
    v_need := public.olnu_party_need(p_room);
    if not (v_uid = any (v_need)) or r.pub->>'rk' is null then raise exception 'not_now'; end if;
    if p_act = 'ready' then
      if r.phase <> 'roles' then raise exception 'not_now'; end if;
      v_val := '1';
    elsif p_act = 'vote' then
      if r.phase not in ('vote', 'final') or r.game not in ('imposter', 'survivor') then raise exception 'not_now'; end if;
      v_t := public.olnu_party_uid(p_room, p_val);
      if v_t is null or v_t = v_uid then raise exception 'invalid_vote'; end if;
      if not exists (select 1 from public.party_players p where p.room_id = p_room and p.user_id = v_t and p.status = 'in') then
        raise exception 'invalid_vote';
      end if;
      v_val := p_val;
    elsif p_act = 'answer' then
      if r.phase <> 'write' then raise exception 'not_now'; end if;
      if r.game = 'hatten' and r.pub->>'pk' = 'w' then
        if public.olnu_party_uid(p_room, p_val) is null then raise exception 'invalid_answer'; end if;
        v_val := p_val;
      else
        v_val := public.olnu_party_text(p_val, case when r.game = 'flocken' then 30 else 60 end);
        if v_val is null then raise exception 'invalid_answer'; end if;
      end if;
    elsif p_act = 'best' then
      if r.game <> 'hatten' or r.phase <> 'vote' or p_val !~ '^[0-9]{1,2}$' then raise exception 'not_now'; end if;
      if p_val::int >= jsonb_array_length(coalesce(r.sec->'slips', '[]'::jsonb)) then raise exception 'invalid_vote'; end if;
      if r.sec->'auth'->>(p_val::int) = v_uid::text then raise exception 'own_answer'; end if;
      v_val := p_val;
    elsif p_act = 'slide' then
      if r.game <> 'vagen' or r.phase <> 'guess' or p_val !~ '^[0-9]{1,3}$' or p_val::int > 100 then raise exception 'invalid_answer'; end if;
      v_val := p_val;
    elsif p_act = 'guess' then
      if r.game <> 'imposter' or r.phase <> 'guess' then raise exception 'not_now'; end if;
      v_val := coalesce(public.olnu_party_text(p_val, 40), '?');
    end if;
    insert into public.party_inputs (room_id, game_no, rk, user_id, val) values (p_room, r.game_no, r.pub->>'rk', v_uid, v_val)
    on conflict (room_id, game_no, rk, user_id) do update set val = excluded.val, updated_at = now();
    update public.party_rooms set v = v + 1, updated_at = now() where id = p_room;
    perform public.olnu_party_next(p_room, false);
  else
    raise exception 'invalid_act';
  end if;
  return public.olnu_party_view(p_room, v_uid);
end; $function$;
