-- 0072 PARTYSPEL: the client RPCs + the meriter trigger. Needs 0070, 0071 and 0036 (olnu_mer_add). Safe to run again.
-- party_create · party_join · party_state (poll) · party_act (every move) · party_group · party_mine.

-- What one player may see: the public state + only their own secret (word / imposter / target / own slip).
create or replace function public.olnu_party_view(p_room uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.party_rooms; me public.party_players; h public.party_players;
  v_need uuid[]; v_done uuid[]; v_pub jsonb; v_priv jsonb := '{}'::jsonb; v_players jsonb; v_mine text; v_imps uuid[];
  v_away boolean; v_idx int;
begin
  select * into r from public.party_rooms where id = p_room;
  select * into me from public.party_players where room_id = p_room and user_id = p_uid;
  select * into h from public.party_players where room_id = p_room and user_id = r.host;
  v_need := public.olnu_party_need(p_room);
  v_done := coalesce(array(select i.user_id from public.party_inputs i
                            where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk'), '{}'::uuid[]);
  v_away := h.user_id is null or h.status = 'left' or h.seen_at < now() - interval '45 seconds';
  select coalesce(jsonb_agg(jsonb_build_object('k', p.k, 'name', p.name, 'is_host', p.is_host, 'status', p.status,
           'in_game', p.in_game, 'score', p.score, 'wins', p.wins, 'is_me', p.user_id = p_uid,
           'done', p.user_id = any (v_done), 'need', p.user_id = any (v_need), 'on', p.seen_at > now() - interval '40 seconds')
           order by p.is_host desc, p.ord, p.joined_at), '[]'::jsonb)
    into v_players from public.party_players p where p.room_id = p_room and p.status <> 'left';

  v_pub := r.pub;
  -- the slips of Namn i hatten come out one at a time
  if r.game = 'hatten' and r.phase = 'reveal' then
    v_pub := jsonb_set(v_pub, '{slips}', coalesce((select jsonb_agg(s.x order by s.i) from jsonb_array_elements(r.pub->'slips')
      with ordinality as s(x, i) where s.i <= r.step), '[]'::jsonb));
  end if;

  if r.pub ? 'rk' and r.pub->>'rk' is not null then
    select i.val into v_mine from public.party_inputs i
     where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = p_uid;
    v_priv := v_priv || jsonb_build_object('mine', v_mine);
  end if;
  if r.game = 'imposter' and me.in_game and r.phase not in ('lobby', 'end') then
    v_imps := coalesce(array(select x::uuid from jsonb_array_elements_text(r.sec->'imps') x), '{}'::uuid[]);
    if p_uid = any (v_imps) then
      v_priv := v_priv || jsonb_build_object('imp', true, 'imp_n', cardinality(v_imps),
        'hint', case when coalesce((r.pub->>'hint')::boolean, true) then r.sec->>'hint' else null end);
    else
      v_priv := v_priv || jsonb_build_object('imp', false, 'word', r.sec->>'word');
    end if;
  elsif r.game = 'vagen' and r.phase in ('clue', 'guess') and me.k = r.pub->>'psy_k' then
    v_priv := v_priv || jsonb_build_object('target', (r.sec->>'target')::int);
  elsif r.game = 'hatten' and r.phase = 'vote' then
    select (a.i - 1)::int into v_idx from jsonb_array_elements_text(r.sec->'auth') with ordinality as a(u, i) where a.u = p_uid::text limit 1;
    v_priv := v_priv || jsonb_build_object('my_slip', v_idx);
  end if;

  return jsonb_build_object('v', r.v, 'now', now(), 'id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase,
    'round', r.round, 'step', r.step, 'game_no', r.game_no, 'opts', r.opts, 'expires_at', r.expires_at,
    'group_id', r.group_id, 'closed', r.closed or r.expires_at <= now(),
    'host_k', h.k, 'host_name', h.name, 'host_away', v_away,
    'me', jsonb_build_object('k', me.k, 'name', me.name, 'is_host', me.is_host, 'status', me.status, 'in_game', me.in_game,
      'score', me.score, 'wins', me.wins, 'can_host', me.is_host or (v_away and me.status in ('in', 'out', 'wait', 'tv'))),
    'players', v_players, 'pub', v_pub, 'priv', v_priv);
end; $$;

create or replace function public.party_create(p_group_id uuid default null, p_name text default null, p_game text default 'imposter')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_name text; v_code text; v_id uuid; v_try int := 0; v_gname text;
  v_abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
begin
  if p_game is null or p_game not in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen') then raise exception 'invalid_game'; end if;
  if p_group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid;
    if not found then raise exception 'not_member'; end if;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname));
  if v_name is null then raise exception 'invalid_name'; end if;
  if not public.olnu_party_lim(v_uid, 'create', 15, interval '1 hour') then raise exception 'slow_down'; end if;
  -- one open room per host
  update public.party_rooms set closed = true, v = v + 1, updated_at = now()
   where host = v_uid and not closed and expires_at > now();
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..4 loop v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1); end loop;
    exit when not exists (select 1 from public.party_rooms r where r.code = v_code and not r.closed and r.expires_at > now());
    if v_try > 40 then raise exception 'busy'; end if;
  end loop;
  insert into public.party_rooms (code, host, group_id, game) values (v_code, v_uid, p_group_id, p_game) returning id into v_id;
  insert into public.party_players (room_id, user_id, k, name, is_host, status, ord)
  values (v_id, v_uid, public.olnu_party_k(v_id, v_uid), v_name, true, 'in', 0);
  return public.olnu_party_view(v_id, v_uid);
end; $$;

create or replace function public.party_join(p_code text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.olnu_uid(); v_code text; r public.party_rooms; v_name text; v_gname text; v_n int; v_old public.party_players;
  v_base text; v_i int := 1;
begin
  if not public.olnu_party_lim(v_uid, 'join', 30, interval '10 minutes') then raise exception 'slow_down'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z]', '', 'g'));
  if length(v_code) <> 4 then raise exception 'room_not_found'; end if;
  select * into r from public.party_rooms where code = v_code and not closed and expires_at > now()
   order by created_at desc limit 1 for update;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into v_old from public.party_players where room_id = r.id and user_id = v_uid;
  if r.group_id is not null then
    select gm.display_name into v_gname from public.group_members gm where gm.group_id = r.group_id and gm.user_id = v_uid;
  end if;
  v_name := public.olnu_party_name(coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_gname, v_old.name));
  if v_name is null then raise exception 'invalid_name'; end if;
  -- two players with the same name get a number
  v_base := v_name;
  while exists (select 1 from public.party_players p where p.room_id = r.id and p.user_id <> v_uid and p.status <> 'left'
                 and lower(p.name) = lower(v_name)) loop
    v_i := v_i + 1; v_name := left(v_base, 17) || ' ' || v_i;
  end loop;
  if v_old.user_id is null then
    select count(*) into v_n from public.party_players p where p.room_id = r.id and p.status <> 'left';
    if v_n >= 16 then raise exception 'room_full'; end if;
    insert into public.party_players (room_id, user_id, k, name, status, ord)
    values (r.id, v_uid, public.olnu_party_k(r.id, v_uid), v_name, case when r.phase in ('lobby', 'end') then 'in' else 'wait' end, 900);
  else
    update public.party_players set name = v_name, seen_at = now(),
           status = case when status = 'left' then case when r.phase in ('lobby', 'end') then 'in' else 'wait' end else status end
     where room_id = r.id and user_id = v_uid;
  end if;
  update public.party_rooms set v = v + 1, updated_at = now() where id = r.id;
  return public.olnu_party_view(r.id, v_uid);
end; $$;

-- The poll (every ~1.2 s while a game screen is open). p_v = the last v the phone has: same v -> {same:true}.
create or replace function public.party_state(p_room uuid, p_v int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.party_rooms; me public.party_players; v_away boolean;
begin
  select * into r from public.party_rooms where id = p_room;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into me from public.party_players where room_id = p_room and user_id = v_uid;
  if me.user_id is null or me.status = 'left' then raise exception 'not_in_room'; end if;
  if r.closed or r.expires_at <= now() then
    return jsonb_build_object('closed', true, 'expired', r.expires_at <= now(), 'v', r.v, 'id', r.id, 'code', r.code);
  end if;
  if me.seen_at < now() - interval '10 seconds' then
    update public.party_players set seen_at = now() where room_id = p_room and user_id = v_uid;
  end if;
  if coalesce(p_v, 0) = r.v then
    select h.status = 'left' or h.seen_at < now() - interval '45 seconds' into v_away
      from public.party_players h where h.room_id = p_room and h.user_id = r.host;
    return jsonb_build_object('same', true, 'v', r.v, 'host_away', coalesce(v_away, true));
  end if;
  return public.olnu_party_view(p_room, v_uid);
end; $$;

-- Every move. Host moves: start (p_data {game, opts, list}), next, tovote, accept, all, lobby, game (p_val), kick (p_val k),
-- close. Anyone: leave. Player inputs: ready, done, vote (k), answer (k or text), best (slip index), slide (0-100), guess.
create or replace function public.party_act(p_room uuid, p_act text, p_val text default null, p_data jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end; $$;

-- The group page tile: is a room of this group open right now?
create or replace function public.party_group(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); r public.party_rooms; v_n int; v_in boolean; v_host text;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select * into r from public.party_rooms where group_id = p_group_id and not closed and expires_at > now()
   order by created_at desc limit 1;
  if r.id is null then return jsonb_build_object('room', null); end if;
  select count(*) filter (where p.status <> 'left'), bool_or(p.user_id = v_uid and p.status <> 'left')
    into v_n, v_in from public.party_players p where p.room_id = r.id;
  select p.name into v_host from public.party_players p where p.room_id = r.id and p.user_id = r.host;
  return jsonb_build_object('room', jsonb_build_object('id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase,
    'n', v_n, 'host_name', v_host, 'is_in', coalesce(v_in, false), 'is_host', r.host = v_uid, 'expires_at', r.expires_at));
end; $$;

-- After a reload: my newest open room.
create or replace function public.party_mine()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  select jsonb_build_object('id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase, 'is_host', r.host = v_uid, 'group_id', r.group_id)
    into v
    from public.party_players p join public.party_rooms r on r.id = p.room_id
   where p.user_id = v_uid and p.status <> 'left' and not r.closed and r.expires_at > now()
   order by p.joined_at desc limit 1;
  return jsonb_build_object('room', v);
end; $$;

-- Meriter (CONTRACT v26 ledger): a finished game with 3+ players = party 2 p (max 3 games a night = 6),
-- a win = party_win 3 p (max 3 a night = 9).
create or replace function public.olnu_zz_mer_party_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.olnu_mer_add(new.user_id, new.night, 'party', new.room_id::text || ':' || new.game_no, 2, 6);
    if new.won then
      perform public.olnu_mer_add(new.user_id, new.night, 'party_win', new.room_id::text || ':' || new.game_no, 3, 9);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
create or replace trigger olnu_zz_mer_party after insert on public.party_results
  for each row execute function public.olnu_zz_mer_party_tg();

do $$
declare f text;
begin
  foreach f in array array['olnu_party_view(uuid, uuid)', 'olnu_zz_mer_party_tg()'] loop
    execute 'revoke all on function public.' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.' || f || ' from anon, authenticated';
    end if;
  end loop;
  foreach f in array array['party_create(uuid, text, text)', 'party_join(text, text)', 'party_state(uuid, integer)',
    'party_act(uuid, text, text, jsonb)', 'party_group(uuid)', 'party_mine()'] loop
    execute 'revoke all on function public.' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.' || f || ' from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'grant execute on function public.' || f || ' to authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.' || f || ' to service_role';
    end if;
  end loop;
end $$;
