-- 0185 🎉 SPEL 3 (games3): additive, safe to run again, no row is removed. Same signatures and shapes as 0169.
-- 1. 📨 Event groups (0166) can play the room games: spel_group / spel_open accept the event people (olnu_evg_member =
--    creator + ✅ + 🤔 while the event is open; name = their own name). spel_state / spel_act already check the room players.
-- 2. 🧠 Gängkollen (game 'quiz'): a quiz about the group itself. The starter's phone builds 3–30 questions from the group's
--    own stats (group_status / group_now: names, beers tonight, all-time totals, meriter, ranks, places) and sends them at
--    start: p_data {game:'quiz', goal, qs:[{q, o:[2–4 options], a}]}. The answers stay in sec (never returned); each round
--    pub.q = {q, o}; vote p_val '0'–'3'; result pub.res = {a, picks:[{i, names}], right:[{k,name}], wrong:[{k,name}]};
--    right = +1 point. Min 2 players. The game ends after min(goal, questions) rounds.
-- Needs 0166 (olnu_evg_member), 0045 (olnu_friend_name), 0168–0169.

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
        'black', v_b, 'pick', v_pick, 'goal', r.goal, 't0', now()),
      sec = sec || jsonb_build_object('judge', v_j, 'jord', v_jo, 'black', to_jsonb(v_bl), 'amap', '[]'::jsonb)
     where id = p_room;
    perform public.olnu_spel_deal(p_room);
  elsif r.game = 'quiz' then
    v_p := r.round;
    update public.spel_rooms set phase = 'vote', round = r.round + 1, v = v + 1, updated_at = now(),
      pub = jsonb_build_object('round', r.round + 1, 'prompt', v_p, 'q', coalesce(r.sec->'qq'->v_p, '{}'::jsonb), 'goal', r.goal, 't0', now())
     where id = p_room;
  else
    v_key := 'd_' || r.game;
    v_np := greatest(1, coalesce((r.sec->'cfg'->>'np')::int, 1));
    v_dk := coalesce(array(select x::int from jsonb_array_elements_text(coalesce(r.sec->v_key, '[]'::jsonb)) x where x::int < v_np), '{}'::int[]);
    if coalesce(cardinality(v_dk), 0) = 0 then v_dk := public.olnu_spel_deck(v_np); end if;
    v_p := v_dk[1]; v_dk := coalesce(v_dk[2:], '{}'::int[]);
    update public.spel_rooms set phase = 'vote', round = r.round + 1, v = v + 1, updated_at = now(),
      pub = jsonb_build_object('round', r.round + 1, 'prompt', v_p, 'goal', r.goal, 't0', now()),
      sec = jsonb_set(sec, array[v_key], to_jsonb(v_dk))
     where id = p_room;
  end if;
end; $$;

/* ---------- close a pick / vote round ---------- */
create or replace function public.olnu_spel_close(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.spel_rooms; x record; v_i int := 0; v_ans jsonb := '[]'::jsonb; v_map jsonb := '[]'::jsonb; v_cards int[];
  v_res jsonb; v_top text[]; v_na int; v_nb int; v_drink text;
begin
  select * into r from public.spel_rooms where id = p_room for update;
  if r.phase = 'pick' then
    for x in select i.user_id, i.val from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
              where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round and p.status = 'in'
                and i.user_id <> (r.sec->>'judge')::uuid order by random() loop
      v_cards := array(select y::int from jsonb_array_elements_text(x.val) y);
      v_ans := v_ans || jsonb_build_array(jsonb_build_object('i', v_i, 'cards', to_jsonb(v_cards)));
      v_map := v_map || jsonb_build_array(x.user_id::text);
      update public.spel_players set hand = coalesce(array(select h from unnest(hand) h where not (h = any (v_cards))), '{}'::int[])
       where room_id = p_room and user_id = x.user_id;
      v_i := v_i + 1;
    end loop;
    if v_i = 0 then perform public.olnu_spel_round(p_room); return; end if;
    update public.spel_rooms set phase = 'judge', v = v + 1, updated_at = now(),
      pub = pub || jsonb_build_object('answers', v_ans, 't1', now()), sec = jsonb_set(sec, '{amap}', v_map)
     where id = p_room;
  elsif r.phase = 'vote' then
    if r.game = 'vem' then
      with v as (
        select i.val #>> '{}' as t from public.spel_inputs i where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round
      ), c as (
        select p.k, p.name, p.ord, (select count(*) from v where v.t = p.k)::int as n from public.spel_players p where p.room_id = p_room and p.status = 'in'
      )
      select jsonb_build_object('counts', coalesce((select jsonb_agg(jsonb_build_object('k', c.k, 'name', c.name, 'n', c.n) order by c.n desc, c.ord) from c where c.n > 0), '[]'::jsonb),
                                'n', (select count(*) from v)::int),
             coalesce(array(select c.k from c where c.n > 0 and c.n = (select max(n) from c)), '{}'::text[])
        into v_res, v_top;
      v_res := v_res || jsonb_build_object('top', to_jsonb(v_top));
      update public.spel_players set score = score + 1 where room_id = p_room and k = any (v_top);
    elsif r.game = 'aldrig' then
      select jsonb_build_object(
        'yes', coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord) filter (where i.val #>> '{}' = 'y'), '[]'::jsonb),
        'no', coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord) filter (where i.val #>> '{}' = 'n'), '[]'::jsonb))
        into v_res
        from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
       where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round;
      update public.spel_players p set score = score + 1 from public.spel_inputs i
       where p.room_id = p_room and i.room_id = p_room and i.user_id = p.user_id and i.game_no = r.game_no and i.round = r.round and i.val #>> '{}' = 'y';
    elsif r.game = 'quiz' then
      -- right answer = +1 point; the result lists who picked what
      v_drink := coalesce(r.sec->'qa'->>(r.round - 1), '0');
      select jsonb_build_object('a', v_drink::int,
        'picks', coalesce((select jsonb_agg(jsonb_build_object('i', z.o, 'names', z.names) order by z.o) from (
            select (i.val #>> '{}')::int as o, jsonb_agg(p.name order by p.ord) as names
              from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
             where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round group by 1) z), '[]'::jsonb),
        'right', coalesce((select jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord)
              from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
             where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round and i.val #>> '{}' = v_drink), '[]'::jsonb),
        'wrong', coalesce((select jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord)
              from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
             where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round and i.val #>> '{}' <> v_drink), '[]'::jsonb))
        into v_res;
      update public.spel_players p set score = score + 1 from public.spel_inputs i
       where p.room_id = p_room and i.room_id = p_room and i.user_id = p.user_id and i.game_no = r.game_no and i.round = r.round and i.val #>> '{}' = v_drink;
    else -- hellre: the smaller side drinks
      select jsonb_build_object(
        'a', coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord) filter (where i.val #>> '{}' = 'a'), '[]'::jsonb),
        'b', coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name) order by p.ord) filter (where i.val #>> '{}' = 'b'), '[]'::jsonb))
        into v_res
        from public.spel_inputs i join public.spel_players p on p.room_id = i.room_id and p.user_id = i.user_id
       where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round;
      v_na := jsonb_array_length(v_res->'a'); v_nb := jsonb_array_length(v_res->'b');
      v_drink := case when v_na = v_nb then null when v_na < v_nb then 'a' else 'b' end;
      v_res := v_res || jsonb_build_object('drink', v_drink);
      if v_drink is not null then
        update public.spel_players p set score = score + 1 from public.spel_inputs i
         where p.room_id = p_room and i.room_id = p_room and i.user_id = p.user_id and i.game_no = r.game_no and i.round = r.round and i.val #>> '{}' = v_drink;
      end if;
    end if;
    update public.spel_rooms set phase = 'result', v = v + 1, updated_at = now(),
      pub = pub || jsonb_build_object('res', coalesce(v_res, '{}'::jsonb), 'board', public.olnu_spel_board(p_room))
     where id = p_room;
  end if;
end; $$;

/* ---------- client RPCs ---------- */
create or replace function public.spel_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.spel_rooms; v_n int; v_names jsonb; v_in boolean;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid)
     and not public.olnu_evg_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  select * into r from public.spel_rooms where group_id = p_group_id and not closed and expires_at > now() order by created_at desc limit 1;
  if r.id is null then return jsonb_build_object('room', null); end if;
  select count(*)::int, coalesce(jsonb_agg(p.name order by p.seen_at desc), '[]'::jsonb) into v_n, v_names
    from public.spel_players p where p.room_id = r.id and p.status = 'in' and p.seen_at > now() - interval '75 seconds';
  select exists (select 1 from public.spel_players p where p.room_id = r.id and p.user_id = v_uid and p.status = 'in') into v_in;
  if v_n = 0 then return jsonb_build_object('room', null); end if;
  return jsonb_build_object('room', jsonb_build_object('id', r.id, 'game', r.game, 'phase', r.phase, 'round', r.round, 'n', v_n,
    'names', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select jsonb_array_elements(v_names) x limit 4) s), 'is_in', v_in));
end; $$;

-- Create or join the group's room. p_game (optional): switch the game while the room is in the lobby / at the end.
create or replace function public.spel_open(p_group_id uuid, p_game text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.spel_rooms; v_name text; me public.spel_players; v_ord int;
begin
  if p_game is not null and p_game not in ('kort', 'vem', 'aldrig', 'hellre', 'quiz') then raise exception 'invalid_game'; end if;
  select public.olnu_party_name(m.display_name) into v_name from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid;
  if not found then
    -- 📨 event group (0166): creator + ✅ + 🤔 may play, name = their own name
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
