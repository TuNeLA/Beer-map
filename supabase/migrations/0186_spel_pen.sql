-- 0186 🎉 SPEL · the room's penalty pack (owner 2026-11-07, store-safe wording). Additive, safe to run again, no row removed.
-- spel_act start takes p_data.pen ('utm' Utmaning = default, 'skal' Skålstraff, 'streck' Skamstreck, 'klunk' Klassiskt, web only)
-- and keeps it in sec.pen; every round's pub carries 'pen', so all phones show the same penalty text. Unknown = 'utm'.
-- The words live in ONE client table (docs/js/spel.js OLNU_PEN). Needs 0185.

/* ---------- start the next round ---------- */
create or replace function public.olnu_spel_round(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.spel_rooms; v_j uuid; v_jn text; v_jo int; v_bl int[]; v_b int; v_nb int; v_pick int;
  v_np int; v_dk int[]; v_p int; v_key text;
begin
  select * into r from public.spel_rooms where id = p_room for update;
  if r.game = 'kort' then
    v_jo := coalesce((r.sec->>'jord')::int, -1);
    -- next judge: the next active player after the last judge (turn order), else anyone playing
    select p.user_id, p.name, p.ord into v_j, v_jn, v_jo from public.spel_players p
     where p.room_id = p_room and p.status = 'in' and p.user_id = any (public.olnu_spel_active(p_room))
     order by (p.ord <= v_jo), p.ord limit 1;
    if v_j is null then
      select p.user_id, p.name, p.ord into v_j, v_jn, v_jo from public.spel_players p
       where p.room_id = p_room and p.status = 'in' order by (p.ord <= v_jo), p.ord limit 1;
    end if;
    v_nb := coalesce(jsonb_array_length(r.sec->'cfg'->'bp'), 0);
    v_bl := coalesce(array(select x::int from jsonb_array_elements_text(coalesce(r.sec->'black', '[]'::jsonb)) x), '{}'::int[]);
    if coalesce(cardinality(v_bl), 0) = 0 then v_bl := public.olnu_spel_deck(v_nb); end if;
    v_b := v_bl[1]; v_bl := coalesce(v_bl[2:], '{}'::int[]);
    v_pick := least(2, greatest(1, coalesce((r.sec->'cfg'->'bp'->>v_b)::int, 1)));
    update public.spel_rooms set phase = 'pick', round = r.round + 1, v = v + 1, updated_at = now(),
      pub = jsonb_build_object('round', r.round + 1, 'judge_k', public.olnu_spel_k(p_room, v_j), 'judge_name', v_jn,
        'black', v_b, 'pick', v_pick, 'goal', r.goal, 't0', now(), 'pen', coalesce(r.sec->>'pen', 'utm')),
      sec = sec || jsonb_build_object('judge', v_j, 'jord', v_jo, 'black', to_jsonb(v_bl), 'amap', '[]'::jsonb)
     where id = p_room;
    perform public.olnu_spel_deal(p_room);
  elsif r.game = 'quiz' then
    v_p := r.round;
    update public.spel_rooms set phase = 'vote', round = r.round + 1, v = v + 1, updated_at = now(),
      pub = jsonb_build_object('round', r.round + 1, 'prompt', v_p, 'q', coalesce(r.sec->'qq'->v_p, '{}'::jsonb), 'goal', r.goal, 't0', now(), 'pen', coalesce(r.sec->>'pen', 'utm'))
     where id = p_room;
  else
    v_key := 'd_' || r.game;
    v_np := greatest(1, coalesce((r.sec->'cfg'->>'np')::int, 1));
    v_dk := coalesce(array(select x::int from jsonb_array_elements_text(coalesce(r.sec->v_key, '[]'::jsonb)) x where x::int < v_np), '{}'::int[]);
    if coalesce(cardinality(v_dk), 0) = 0 then v_dk := public.olnu_spel_deck(v_np); end if;
    v_p := v_dk[1]; v_dk := coalesce(v_dk[2:], '{}'::int[]);
    update public.spel_rooms set phase = 'vote', round = r.round + 1, v = v + 1, updated_at = now(),
      pub = jsonb_build_object('round', r.round + 1, 'prompt', v_p, 'goal', r.goal, 't0', now(), 'pen', coalesce(r.sec->>'pen', 'utm')),
      sec = jsonb_set(sec, array[v_key], to_jsonb(v_dk))
     where id = p_room;
  end if;
end; $$;

-- Every move. Anyone in the room: start (p_data {game, goal, nw, bp:[1|2...], np}), next, end, lobby, game (p_val), leave.
-- kort: play (p_data {cards:[id..]}), best (p_val = answer index; the judge, or anyone when the judge is away), force.
-- vem / aldrig / hellre: vote (p_val = player k | y | n | a | b), force.
create or replace function public.spel_act(p_room uuid, p_act text, p_val text default null, p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); r public.spel_rooms; me public.spel_players; v_game text; v_n int; v_goal int;
  v_cards int[]; v_i int; v_w uuid; v_s int; v_cfg jsonb; v_sec jsonb; v_view jsonb;
begin
  if not public.olnu_party_lim(v_uid, 'spel_act', 200, interval '1 minute') then raise exception 'slow_down'; end if;
  select * into r from public.spel_rooms where id = p_room for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  if r.closed or r.expires_at <= now() then raise exception 'room_closed'; end if;
  select * into me from public.spel_players where room_id = p_room and user_id = v_uid;
  if me.user_id is null or me.status <> 'in' then raise exception 'not_in_room'; end if;
  update public.spel_players set seen_at = now() where room_id = p_room and user_id = v_uid and seen_at < now() - interval '5 seconds';
  v_view := public.olnu_spel_view(p_room, v_uid);

  if p_act = 'start' then
    if r.phase not in ('lobby', 'end') then raise exception 'not_now'; end if;
    v_game := coalesce(nullif(p_data->>'game', ''), r.game);
    if v_game not in ('kort', 'vem', 'aldrig', 'hellre', 'quiz') then raise exception 'invalid_game'; end if;
    v_n := cardinality(public.olnu_spel_active(p_room));
    if v_n < (case when v_game in ('kort', 'vem') then 3 else 2 end) then raise exception 'too_few'; end if;
    if v_game = 'quiz' then
      -- 🧠 Gängkollen: the starter's phone sends the questions [{q, o:[2–4], a}] made from the group's own stats
      if jsonb_typeof(p_data->'qs') <> 'array' or jsonb_array_length(p_data->'qs') < 3 or jsonb_array_length(p_data->'qs') > 30
         or exists (select 1 from jsonb_array_elements(p_data->'qs') q where jsonb_typeof(q->'o') <> 'array' or jsonb_array_length(q->'o') not between 2 and 4
                      or length(coalesce(q->>'q', '')) not between 3 and 160 or coalesce((q->>'a')::int, -1) not between 0 and jsonb_array_length(q->'o') - 1
                      or exists (select 1 from jsonb_array_elements_text(q->'o') o where length(o) not between 1 and 48))
      then raise exception 'invalid_content'; end if;
    end if;
    v_goal := coalesce((p_data->>'goal')::int, case when v_game = 'kort' then 5 else 12 end);
    v_goal := case when v_game = 'kort' then least(15, greatest(2, v_goal)) else least(50, greatest(3, v_goal)) end;
    if v_game = 'quiz' then v_goal := least(v_goal, jsonb_array_length(p_data->'qs')); end if;
    v_sec := r.sec - 'judge' - 'amap';
    if v_game = 'kort' then
      if jsonb_typeof(p_data->'bp') <> 'array' or jsonb_array_length(p_data->'bp') < 5 or jsonb_array_length(p_data->'bp') > 2000
         or coalesce((p_data->>'nw')::int, 0) < 30 or (p_data->>'nw')::int > 5000 then raise exception 'invalid_content'; end if;
      v_cfg := jsonb_build_object('nw', (p_data->>'nw')::int, 'bp', p_data->'bp');
      if coalesce(r.sec->'cfg'->>'nw', '') <> (p_data->>'nw') or coalesce(jsonb_array_length(r.sec->'cfg'->'bp'), 0) <> jsonb_array_length(p_data->'bp') then
        v_sec := v_sec - 'white' - 'black';
      end if;
      v_sec := v_sec || jsonb_build_object('cfg', v_cfg);
    elsif v_game = 'quiz' then
      v_sec := v_sec || jsonb_build_object('qq', (select jsonb_agg(jsonb_build_object('q', q->>'q', 'o', q->'o') order by n) from jsonb_array_elements(p_data->'qs') with ordinality x(q, n)),
                                           'qa', (select jsonb_agg((q->>'a')::int order by n) from jsonb_array_elements(p_data->'qs') with ordinality x(q, n)));
    else
      if coalesce((p_data->>'np')::int, 0) < 5 or (p_data->>'np')::int > 5000 then raise exception 'invalid_content'; end if;
      v_sec := v_sec || jsonb_build_object('cfg', coalesce(r.sec->'cfg', '{}'::jsonb) || jsonb_build_object('np', (p_data->>'np')::int));
    end if;
    -- ⚖️ the room's penalty pack (the client text table PENALTY: utm | skal | streck | klunk), shown on every phone
    v_sec := v_sec || jsonb_build_object('pen', case when p_data->>'pen' in ('utm', 'skal', 'streck', 'klunk') then p_data->>'pen' else 'utm' end);
    update public.spel_players set score = 0, hand = '{}'::int[] where room_id = p_room;
    update public.spel_rooms set game = v_game, goal = v_goal, game_no = game_no + 1, round = 0, sec = v_sec, pub = '{}'::jsonb,
      expires_at = greatest(expires_at, now() + interval '2 hours') where id = p_room;
    perform public.olnu_spel_round(p_room);

  elsif p_act = 'play' then
    if r.game <> 'kort' or r.phase <> 'pick' then raise exception 'not_now'; end if;
    if v_uid = (r.sec->>'judge')::uuid then raise exception 'not_now'; end if;
    if jsonb_typeof(p_data->'cards') <> 'array' then raise exception 'invalid_cards'; end if;
    v_cards := array(select x::int from jsonb_array_elements_text(p_data->'cards') x);
    if cardinality(v_cards) <> (r.pub->>'pick')::int or not (v_cards <@ me.hand)
       or (select count(distinct x) from unnest(v_cards) x) <> cardinality(v_cards) then raise exception 'invalid_cards'; end if;
    insert into public.spel_inputs (room_id, game_no, round, user_id, val) values (p_room, r.game_no, r.round, v_uid, to_jsonb(v_cards))
      on conflict (room_id, game_no, round, user_id) do update set val = excluded.val, updated_at = now();
    update public.spel_rooms set v = v + 1 where id = p_room;
    perform public.olnu_spel_auto(p_room);

  elsif p_act = 'vote' then
    if r.game = 'kort' or r.phase <> 'vote' then raise exception 'not_now'; end if;
    if r.game = 'vem' then
      if p_val is null or p_val = me.k or not exists (select 1 from public.spel_players p where p.room_id = p_room and p.k = p_val and p.status = 'in') then
        raise exception 'invalid_vote'; end if;
    elsif r.game = 'aldrig' then
      if p_val is null or p_val not in ('y', 'n') then raise exception 'invalid_vote'; end if;
    elsif r.game = 'quiz' then
      if p_val is null or p_val !~ '^[0-3]$' or p_val::int >= coalesce(jsonb_array_length(r.pub->'q'->'o'), 0) then raise exception 'invalid_vote'; end if;
    else
      if p_val is null or p_val not in ('a', 'b') then raise exception 'invalid_vote'; end if;
    end if;
    insert into public.spel_inputs (room_id, game_no, round, user_id, val) values (p_room, r.game_no, r.round, v_uid, to_jsonb(p_val))
      on conflict (room_id, game_no, round, user_id) do update set val = excluded.val, updated_at = now();
    update public.spel_rooms set v = v + 1 where id = p_room;
    perform public.olnu_spel_auto(p_room);

  elsif p_act = 'best' then
    if r.game <> 'kort' or r.phase <> 'judge' then raise exception 'not_now'; end if;
    if not coalesce((v_view->'me'->>'can_force')::boolean, false) then raise exception 'not_judge'; end if;
    v_i := nullif(p_val, '')::int;
    if v_i is null or v_i < 0 or v_i >= jsonb_array_length(r.sec->'amap') then raise exception 'invalid_vote'; end if;
    v_w := (r.sec->'amap'->>v_i)::uuid;
    update public.spel_players set score = score + 1 where room_id = p_room and user_id = v_w returning score into v_s;
    update public.spel_rooms set phase = case when v_s >= r.goal then 'end' else 'result' end, v = v + 1, updated_at = now(),
      pub = pub || jsonb_build_object('win', jsonb_build_object('i', v_i, 'k', public.olnu_spel_k(p_room, v_w),
              'name', public.olnu_party_name((select name from public.spel_players where room_id = p_room and user_id = v_w)),
              'cards', r.pub->'answers'->v_i->'cards', 'score', v_s),
            'board', public.olnu_spel_board(p_room))
     where id = p_room;

  elsif p_act = 'force' then
    if r.phase not in ('pick', 'vote') then raise exception 'not_now'; end if;
    if not coalesce((v_view->'me'->>'can_force')::boolean, false) then raise exception 'not_now'; end if;
    perform public.olnu_spel_close(p_room);

  elsif p_act = 'next' then
    if r.phase <> 'result' then raise exception 'not_now'; end if;
    if r.game <> 'kort' and r.round >= r.goal then
      update public.spel_rooms set phase = 'end', v = v + 1, updated_at = now(), pub = pub || jsonb_build_object('board', public.olnu_spel_board(p_room)) where id = p_room;
    else
      perform public.olnu_spel_round(p_room);
    end if;

  elsif p_act = 'end' then
    if r.phase = 'lobby' then raise exception 'not_now'; end if;
    update public.spel_rooms set phase = 'end', v = v + 1, updated_at = now(), pub = pub || jsonb_build_object('board', public.olnu_spel_board(p_room)) where id = p_room;

  elsif p_act = 'lobby' then
    if r.phase <> 'end' then raise exception 'not_now'; end if;
    update public.spel_rooms set phase = 'lobby', pub = '{}'::jsonb, v = v + 1, updated_at = now() where id = p_room;

  elsif p_act = 'game' then
    if r.phase not in ('lobby', 'end') then raise exception 'not_now'; end if;
    if coalesce(p_val, '') not in ('kort', 'vem', 'aldrig', 'hellre', 'quiz') then raise exception 'invalid_game'; end if;
    update public.spel_rooms set game = p_val, phase = 'lobby', pub = '{}'::jsonb, v = v + 1, updated_at = now() where id = p_room;

  elsif p_act = 'leave' then
    update public.spel_players set status = 'left' where room_id = p_room and user_id = v_uid;
    update public.spel_rooms set v = v + 1 where id = p_room;
    perform public.olnu_spel_auto(p_room);
    return jsonb_build_object('left', true);
  else
    raise exception 'not_now';
  end if;
  return public.olnu_spel_view(p_room, v_uid);
end; $$;
