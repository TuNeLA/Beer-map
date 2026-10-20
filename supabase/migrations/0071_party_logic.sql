-- 0071 PARTYSPEL: the game state machine (server side, so no phone can cheat). Needs 0070. Safe to run again.
-- Games: imposter (Imposter), survivor (Östra lägret), hatten (Namn i hatten), flocken (Flocken), vagen (Vågen).
-- Content (words, prompts, scales) is sent by the host phone at start as plain string lists; the SERVER picks the
-- secret word, the imposters, the targets and keeps them in party_rooms.sec, which is never returned whole.

-- A list of strings from the host: cleaned, min p_min entries, max p_max kept.
create or replace function public.olnu_party_list(p jsonb, p_min int, p_max int, p_len int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'invalid_content'; end if;
  select coalesce(jsonb_agg(x.t order by x.i), '[]'::jsonb) into v from (
    select public.olnu_party_text(e.val, p_len) as t, e.i from jsonb_array_elements_text(p) with ordinality as e(val, i)
  ) x where x.t is not null and x.i <= p_max;
  if jsonb_array_length(v) < p_min then raise exception 'invalid_content'; end if;
  return v;
end; $$;

-- Who must send an input in the current step (empty = the step needs the host / the turn player).
create or replace function public.olnu_party_need(p_room uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare r public.party_rooms;
begin
  select * into r from public.party_rooms where id = p_room;
  if r.id is null then return '{}'::uuid[]; end if;
  if r.game = 'imposter' then
    if r.phase in ('roles', 'vote') then return public.olnu_party_ids(p_room, 'in'); end if;
    if r.phase = 'guess' and r.sec ? 'guesser' then return array[(r.sec->>'guesser')::uuid]; end if;
  elsif r.game = 'survivor' then
    if r.phase = 'vote' then return public.olnu_party_ids(p_room, 'in'); end if;
    if r.phase = 'final' then
      return coalesce(array(select p.user_id from public.party_players p where p.room_id = p_room and p.status = 'out' and p.in_game order by p.ord), '{}'::uuid[]);
    end if;
  elsif r.game in ('hatten', 'flocken') then
    if r.phase in ('write', 'vote') then return public.olnu_party_ids(p_room, 'in'); end if;
  elsif r.game = 'vagen' then
    if r.phase = 'guess' then
      return coalesce(array(select p.user_id from public.party_players p where p.room_id = p_room and p.status = 'in'
                             and p.k is distinct from r.pub->>'psy_k' order by p.ord), '{}'::uuid[]);
    end if;
  end if;
  return '{}'::uuid[];
end; $$;

-- Players with the top score this game (score > 0), optionally not p_not (the pink cow).
create or replace function public.olnu_party_top(p_room uuid, p_not uuid default null)
returns uuid[] language sql stable security definer set search_path = public as $$
  with s as (select p.user_id, p.score from public.party_players p
              where p.room_id = p_room and p.in_game and p.status <> 'left' and p.user_id is distinct from p_not)
  select coalesce(array(select s.user_id from s where s.score > 0 and s.score = (select max(score) from s)), '{}'::uuid[]);
$$;

-- End of a game: wins + the meriter rows (3+ players and 60+ s of play), returns the winners [{k,name}].
create or replace function public.olnu_party_finish(p_room uuid, p_winners uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.party_rooms; v_n int;
begin
  select * into r from public.party_rooms where id = p_room;
  update public.party_players p set wins = p.wins + 1 where p.room_id = p_room and p.user_id = any (coalesce(p_winners, '{}'::uuid[]));
  select count(*) into v_n from public.party_players p where p.room_id = p_room and p.in_game;
  if v_n >= 3 and r.started_at is not null and r.started_at < now() - interval '60 seconds' then
    insert into public.party_results (room_id, game_no, user_id, game, won, night, players)
    select p_room, r.game_no, p.user_id, r.game, p.user_id = any (coalesce(p_winners, '{}'::uuid[])), public.olnu_night_of(now()), v_n
      from public.party_players p where p.room_id = p_room and p.in_game
    on conflict do nothing;
  end if;
  return public.olnu_party_people(p_room, coalesce(p_winners, '{}'::uuid[]));
end; $$;

-- Host: start a game (from the lobby or after a game). p_data = {game, opts{}, list[] (content strings)}.
create or replace function public.olnu_party_start(p_room uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.party_rooms;
  v_game text; v_opts jsonb; v_tv boolean; v_ids uuid[]; v_n int; v_list jsonb; v_pub jsonb; v_sec jsonb;
  v_phase text; v_pick text; v_w text; v_h text; v_imp int; v_rounds int; v_imps uuid[]; v_s text;
begin
  select * into r from public.party_rooms where id = p_room for update;
  if r.phase not in ('lobby', 'end') then raise exception 'not_now'; end if;
  v_game := coalesce(nullif(p_data->>'game', ''), r.game);
  if v_game not in ('imposter', 'survivor', 'hatten', 'flocken', 'vagen') then raise exception 'invalid_game'; end if;
  v_opts := coalesce(p_data->'opts', '{}'::jsonb);
  if jsonb_typeof(v_opts) <> 'object' then v_opts := '{}'::jsonb; end if;
  v_tv := coalesce((v_opts->>'tv')::boolean, false);

  update public.party_players p
     set status = case when p.status = 'left' then 'left' when p.is_host and v_tv then 'tv' else 'in' end,
         score = 0, out_round = null, in_game = false
   where p.room_id = p_room;
  v_ids := public.olnu_party_shuffle(public.olnu_party_ids(p_room, 'in'));
  v_n := cardinality(v_ids);
  if v_n < 3 then raise exception 'too_few'; end if;
  update public.party_players p set in_game = true, ord = x.i
    from unnest(v_ids) with ordinality as x(id, i) where p.room_id = p_room and p.user_id = x.id;

  if v_game = 'imposter' then
    v_imp := least(2, greatest(1, coalesce((v_opts->>'imp')::int, 1)));
    if v_imp = 2 and v_n < 5 then raise exception 'too_few'; end if;
    v_rounds := least(3, greatest(1, coalesce((v_opts->>'rounds')::int, 2)));
    v_list := public.olnu_party_list(p_data->'list', 10, 600, 90);
    v_pick := v_list->>(floor(random() * jsonb_array_length(v_list)))::int;
    v_w := public.olnu_party_text(split_part(v_pick, '|', 1), 40);
    v_h := public.olnu_party_text(split_part(v_pick, '|', 2), 40);
    if v_w is null then raise exception 'invalid_content'; end if;
    v_imps := (public.olnu_party_shuffle(v_ids))[1:v_imp];
    v_sec := jsonb_build_object('word', v_w, 'hint', v_h, 'imps', to_jsonb(v_imps));
    v_pub := jsonb_build_object('rk', 'ready', 'cat', public.olnu_party_text(v_opts->>'cat', 40),
      'emo', public.olnu_party_text(v_opts->>'emo', 8), 'order', public.olnu_party_people(p_room, v_ids),
      'imp_n', v_imp, 'rounds', v_rounds, 'elim', coalesce((v_opts->>'elim')::boolean, false),
      'hint', coalesce((v_opts->>'hint')::boolean, true), 'cycle', 1);
    v_phase := 'roles';
  elsif v_game = 'survivor' then
    v_list := public.olnu_party_list(p_data->'list', 3, 60, 160);
    v_sec := jsonb_build_object('list', v_list);
    v_pub := jsonb_build_object('rk', null, 'prompt', v_list->>0, 'order', public.olnu_party_people(p_room, v_ids));
    v_phase := 'challenge';
  elsif v_game = 'hatten' then
    v_list := public.olnu_party_list(p_data->'list', 3, 15, 160);
    v_sec := jsonb_build_object('list', v_list);
    v_s := v_list->>0;
    v_pub := jsonb_build_object('rk', 'ans:1', 'rounds', jsonb_array_length(v_list),
      'pk', case when v_s like 'w|%' then 'w' else 't' end,
      'prompt', case when v_s ~ '^[wt]\|' then substr(v_s, 3) else v_s end);
    v_phase := 'write';
  elsif v_game = 'flocken' then
    v_list := public.olnu_party_list(p_data->'list', 3, 15, 160);
    v_sec := jsonb_build_object('list', v_list);
    v_pub := jsonb_build_object('rk', 'ans:1', 'rounds', jsonb_array_length(v_list), 'prompt', v_list->>0);
    v_phase := 'write';
  else -- vagen
    v_list := public.olnu_party_list(p_data->'list', 3, 40, 90);
    v_rounds := least(jsonb_array_length(v_list), 12, greatest(3, coalesce((v_opts->>'rounds')::int, v_n)));
    v_sec := jsonb_build_object('list', v_list, 'target', 5 + floor(random() * 91)::int);
    v_s := v_list->>0;
    v_pub := jsonb_build_object('rk', null, 'rounds', v_rounds, 'order', public.olnu_party_people(p_room, v_ids),
      'psy_k', public.olnu_party_k(p_room, v_ids[1]), 'psy_name', public.olnu_party_pname(p_room, v_ids[1]),
      'scale', jsonb_build_array(split_part(v_s, '|', 1), coalesce(nullif(split_part(v_s, '|', 2), ''), '?')));
    v_phase := 'clue';
  end if;

  update public.party_rooms set game = v_game, opts = v_opts, phase = v_phase, round = 1, step = 0, game_no = r.game_no + 1,
         pub = v_pub, sec = v_sec, started_at = now(), v = r.v + 1, updated_at = now()
   where id = p_room;
end; $$;

-- Move the game on. p_force = the host (or the turn player) said "next"; else only when every needed input is in.
-- Returns true when something changed.
create or replace function public.olnu_party_next(p_room uuid, p_force boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r public.party_rooms;
  v_need uuid[]; v_all boolean := false; v_pub jsonb; v_sec jsonb; v_phase text; v_round int; v_step int;
  v_in uuid[]; v_t jsonb; v_imps uuid[]; v_out uuid; v_outk text; v_after text; v_win text; v_n int; v_go text;
  v_il int; v_cl int; v_g text; v_ok boolean; v_x record; v_slips jsonb; v_auth jsonb; v_s text; v_nm text;
  v_fin uuid[]; v_jury uuid[]; v_w uuid; v_max int; v_list jsonb; v_tg int; v_d int; v_p int; v_arr jsonb;
  v_sum int; v_cnt int; v_cow uuid; v_ord jsonb;
begin
  select * into r from public.party_rooms where id = p_room for update;
  if r.id is null or r.phase in ('lobby', 'end') then return false; end if;
  v_need := public.olnu_party_need(p_room);
  if cardinality(v_need) > 0 then
    select count(distinct i.user_id) >= cardinality(v_need) into v_all from public.party_inputs i
     where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = any (v_need);
  end if;
  if not p_force and not v_all then return false; end if;
  v_pub := r.pub; v_sec := r.sec; v_phase := r.phase; v_round := r.round; v_step := r.step;

  /* ===== IMPOSTER ===== */
  if r.game = 'imposter' then
    v_imps := coalesce(array(select x::uuid from jsonb_array_elements_text(r.sec->'imps') x), '{}'::uuid[]);
    if r.phase = 'roles' then
      v_n := jsonb_array_length(v_pub->'order');
      v_phase := 'clue'; v_step := 0;
      v_pub := v_pub || jsonb_build_object('rk', null, 'turn_k', v_pub->'order'->0->>'k', 'turn_name', v_pub->'order'->0->>'name',
        'clue_round', 1, 'turns', v_n * coalesce((v_pub->>'rounds')::int, 2));
    elsif r.phase = 'clue' then
      v_n := greatest(1, jsonb_array_length(v_pub->'order'));
      v_step := v_step + 1;
      if v_step >= coalesce((v_pub->>'turns')::int, v_n) then
        v_phase := 'vote';
        v_pub := v_pub || jsonb_build_object('rk', 'vote:' || coalesce(v_pub->>'cycle', '1'), 'turn_k', null, 'turn_name', null);
      else
        v_pub := v_pub || jsonb_build_object('turn_k', v_pub->'order'->(v_step % v_n)->>'k',
          'turn_name', v_pub->'order'->(v_step % v_n)->>'name', 'clue_round', v_step / v_n + 1);
      end if;
    elsif r.phase = 'vote' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_t := public.olnu_party_tally(p_room, r.game_no, r.pub->>'rk', v_in, v_in);
      if jsonb_array_length(v_t->'top') = 1 then v_outk := v_t->'top'->>0; v_out := public.olnu_party_uid(p_room, v_outk); end if;
      if v_out is null then
        if coalesce((v_pub->>'elim')::boolean, false) then v_after := 'clue'; else v_after := 'end'; v_win := 'imp'; end if;
      else
        update public.party_players set status = 'out', out_round = coalesce((v_pub->>'cycle')::int, 1)
         where room_id = p_room and user_id = v_out;
        if v_out = any (v_imps) then
          v_after := 'guess';
        else
          select count(*) filter (where p.user_id = any (v_imps)), count(*) filter (where not (p.user_id = any (v_imps)))
            into v_il, v_cl from public.party_players p where p.room_id = p_room and p.status = 'in';
          if coalesce((v_pub->>'elim')::boolean, false) and v_il < v_cl then v_after := 'clue'; else v_after := 'end'; v_win := 'imp'; end if;
        end if;
      end if;
      v_phase := 'result';
      v_pub := v_pub || jsonb_build_object('rk', null, 'tally', v_t, 'out_k', v_outk,
        'out_name', public.olnu_party_pname(p_room, v_out), 'out_imp', case when v_out is null then null else v_out = any (v_imps) end,
        'after', v_after, 'win', v_win);
    elsif r.phase = 'result' then
      if v_pub->>'after' = 'guess' then
        v_out := public.olnu_party_uid(p_room, v_pub->>'out_k');
        if v_out is null then v_go := 'end'; v_pub := v_pub || jsonb_build_object('win', 'crew');
        else
          v_phase := 'guess';
          v_sec := v_sec || jsonb_build_object('guesser', v_out);
          v_pub := v_pub || jsonb_build_object('rk', 'guess:' || coalesce(v_pub->>'cycle', '1'), 'guesser_k', v_pub->>'out_k',
            'guesser_name', v_pub->>'out_name');
        end if;
      else
        v_go := v_pub->>'after';
      end if;
    elsif r.phase = 'guess' then
      select i.val into v_g from public.party_inputs i
       where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = (r.sec->>'guesser')::uuid;
      v_ok := v_g is not null and public.olnu_party_same_word(v_g, r.sec->>'word');
      select count(*) into v_il from public.party_players p where p.room_id = p_room and p.status = 'in' and p.user_id = any (v_imps);
      if v_ok then v_after := 'end'; v_win := 'imp';
      elsif v_il = 0 or not coalesce((v_pub->>'elim')::boolean, false) then v_after := 'end'; v_win := 'crew';
      else v_after := 'clue'; v_win := null; end if;
      v_phase := 'guessed';
      v_pub := v_pub || jsonb_build_object('rk', null, 'guess', coalesce(v_g, ''), 'guess_ok', v_ok, 'after', v_after, 'win', v_win);
    elsif r.phase = 'guessed' then
      v_go := v_pub->>'after';
    end if;

    if v_go = 'clue' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_ord := public.olnu_party_people(p_room, v_in);
      v_phase := 'clue'; v_step := 0;
      v_pub := v_pub || jsonb_build_object('cycle', coalesce((v_pub->>'cycle')::int, 1) + 1, 'order', v_ord,
        'turns', cardinality(v_in), 'clue_round', 1, 'turn_k', v_ord->0->>'k', 'turn_name', v_ord->0->>'name',
        'rk', null, 'tally', null, 'after', null, 'out_k', null, 'out_name', null, 'out_imp', null, 'guess', null, 'guess_ok', null);
    elsif v_go = 'end' then
      v_win := coalesce(v_pub->>'win', 'crew');
      if v_win = 'imp' then
        v_fin := v_imps;
        update public.party_players set score = score + 2 where room_id = p_room and user_id = any (v_imps);
      else
        v_fin := coalesce(array(select p.user_id from public.party_players p where p.room_id = p_room and p.in_game
                                  and p.status <> 'left' and not (p.user_id = any (v_imps))), '{}'::uuid[]);
        update public.party_players set score = score + 1 where room_id = p_room and user_id = any (v_fin);
      end if;
      v_phase := 'end';
      v_pub := v_pub || jsonb_build_object('rk', null, 'win', v_win, 'word', r.sec->>'word', 'hint_word', r.sec->>'hint',
        'imps', public.olnu_party_people(p_room, v_imps), 'winners', public.olnu_party_finish(p_room, v_fin));
    end if;

  /* ===== ÖSTRA LÄGRET (survivor) ===== */
  elsif r.game = 'survivor' then
    if r.phase = 'challenge' then
      v_phase := 'vote';
      v_pub := v_pub || jsonb_build_object('rk', 'vote:' || r.round);
    elsif r.phase = 'vote' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_t := public.olnu_party_tally(p_room, r.game_no, r.pub->>'rk', v_in, v_in);
      if jsonb_array_length(v_t->'top') >= 1 then
        v_outk := v_t->'top'->>(floor(random() * jsonb_array_length(v_t->'top')))::int;
        v_out := public.olnu_party_uid(p_room, v_outk);
      end if;
      if v_out is null and cardinality(v_in) > 0 then
        v_out := v_in[1 + floor(random() * cardinality(v_in))::int]; v_outk := public.olnu_party_k(p_room, v_out);
      end if;
      update public.party_players set status = 'out', out_round = r.round where room_id = p_room and user_id = v_out;
      select count(*) into v_n from public.party_players p where p.room_id = p_room and p.status = 'in';
      v_phase := 'result';
      v_pub := v_pub || jsonb_build_object('rk', null, 'tally', v_t, 'out_k', v_outk, 'out_name', public.olnu_party_pname(p_room, v_out),
        'tie', jsonb_array_length(v_t->'top') <> 1, 'after', case when v_n <= 2 then 'final' else 'challenge' end);
    elsif r.phase = 'result' then
      select count(*) into v_n from public.party_players p where p.room_id = p_room and p.status = 'in';
      if v_n <= 2 then
        v_fin := public.olnu_party_ids(p_room, 'in');
        v_phase := 'final';
        v_pub := v_pub || jsonb_build_object('rk', 'jury', 'finalists', public.olnu_party_people(p_room, v_fin), 'tally', null);
      else
        v_round := r.round + 1;
        v_list := r.sec->'list';
        v_phase := 'challenge';
        v_pub := v_pub || jsonb_build_object('rk', null, 'tally', null, 'out_k', null, 'out_name', null,
          'prompt', v_list->>((v_round - 1) % greatest(1, jsonb_array_length(v_list))));
      end if;
    elsif r.phase = 'final' then
      v_fin := public.olnu_party_ids(p_room, 'in');
      v_jury := public.olnu_party_need(p_room);
      v_t := public.olnu_party_tally(p_room, r.game_no, 'jury', v_jury, v_fin);
      if jsonb_array_length(v_t->'top') >= 1 then
        v_w := public.olnu_party_uid(p_room, v_t->'top'->>(floor(random() * jsonb_array_length(v_t->'top')))::int);
      end if;
      if v_w is null and cardinality(v_fin) > 0 then v_w := v_fin[1 + floor(random() * cardinality(v_fin))::int]; end if;
      update public.party_players set score = score + case when user_id = v_w then 3 else 1 end
       where room_id = p_room and user_id = any (v_fin);
      v_phase := 'end';
      v_pub := v_pub || jsonb_build_object('rk', null, 'tally', v_t, 'tie', jsonb_array_length(v_t->'top') <> 1,
        'winner_k', public.olnu_party_k(p_room, v_w), 'winners', public.olnu_party_finish(p_room, array[v_w]));
    end if;

  /* ===== NAMN I HATTEN ===== */
  elsif r.game = 'hatten' then
    if r.phase = 'write' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_slips := '[]'::jsonb; v_auth := '[]'::jsonb;
      for v_x in select i.user_id, i.val from public.party_inputs i
                  where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = any (v_in)
                  order by random() loop
        if v_pub->>'pk' = 'w' then
          select p.name into v_nm from public.party_players p where p.room_id = p_room and p.k = v_x.val and p.status <> 'left';
          if v_nm is null then continue; end if;
          v_slips := v_slips || jsonb_build_array(jsonb_build_object('t', v_nm, 'tk', v_x.val));
        else
          v_slips := v_slips || jsonb_build_array(jsonb_build_object('t', v_x.val));
        end if;
        v_auth := v_auth || to_jsonb(v_x.user_id::text);
      end loop;
      v_sec := v_sec || jsonb_build_object('slips', v_slips, 'auth', v_auth);
      v_phase := 'reveal'; v_step := 0;
      v_pub := v_pub || jsonb_build_object('rk', null, 'slips', v_slips, 'slip_n', jsonb_array_length(v_slips), 'counts', null, 'best', null);
    elsif r.phase = 'reveal' then
      if v_step < coalesce((v_pub->>'slip_n')::int, 0) then
        v_step := v_step + 1;
      elsif v_pub->>'pk' = 'w' then
        select coalesce(jsonb_agg(jsonb_build_object('k', c.tk, 'name', c.t, 'n', c.n) order by c.n desc, c.t), '[]'::jsonb), max(c.n)
          into v_arr, v_max
          from (select s->>'tk' as tk, s->>'t' as t, count(*)::int as n from jsonb_array_elements(v_pub->'slips') s group by 1, 2) c;
        -- everyone who named the top name gets +1 (the hat agrees with you)
        update public.party_players p set score = p.score + 1
          from jsonb_array_elements(r.sec->'slips') with ordinality as s(x, i)
         where p.room_id = p_room and p.user_id = (r.sec->'auth'->>(s.i::int - 1))::uuid
           and (select count(*) from jsonb_array_elements(r.sec->'slips') s2 where s2->>'tk' = s.x->>'tk') = v_max;
        v_phase := 'score';
        v_pub := v_pub || jsonb_build_object('counts', v_arr,
          'top', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_arr) e where (e->>'n')::int = v_max), '[]'::jsonb));
      else
        v_phase := 'vote';
        v_pub := v_pub || jsonb_build_object('rk', 'best:' || r.round);
      end if;
    elsif r.phase = 'vote' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_slips := '[]'::jsonb;
      for v_x in select s.x, (s.i - 1)::int as idx from jsonb_array_elements(r.sec->'slips') with ordinality as s(x, i) order by s.i loop
        select count(*) into v_n from public.party_inputs i
         where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = any (v_in) and i.val = v_x.idx::text;
        v_w := (r.sec->'auth'->>v_x.idx)::uuid;
        update public.party_players set score = score + v_n where room_id = p_room and user_id = v_w;
        v_slips := v_slips || jsonb_build_array(v_x.x || jsonb_build_object('n', v_n, 'by', public.olnu_party_pname(p_room, v_w),
          'by_k', public.olnu_party_k(p_room, v_w)));
      end loop;
      v_phase := 'score';
      v_pub := v_pub || jsonb_build_object('rk', null, 'best',
        coalesce((select jsonb_agg(e order by (e->>'n')::int desc) from jsonb_array_elements(v_slips) e), '[]'::jsonb));
    elsif r.phase = 'score' then
      if r.round >= coalesce((v_pub->>'rounds')::int, 1) then
        v_go := 'end';
      else
        v_round := r.round + 1;
        v_s := r.sec->'list'->>(v_round - 1);
        v_phase := 'write'; v_step := 0;
        v_pub := v_pub || jsonb_build_object('rk', 'ans:' || v_round, 'pk', case when v_s like 'w|%' then 'w' else 't' end,
          'prompt', case when v_s ~ '^[wt]\|' then substr(v_s, 3) else v_s end, 'slips', null, 'slip_n', 0, 'counts', null, 'top', null, 'best', null);
      end if;
    end if;
    if v_go = 'end' then
      v_phase := 'end';
      v_pub := v_pub || jsonb_build_object('rk', null, 'winners', public.olnu_party_finish(p_room, public.olnu_party_top(p_room)));
    end if;

  /* ===== FLOCKEN (think like the herd) ===== */
  elsif r.game = 'flocken' then
    if r.phase = 'write' then
      v_in := public.olnu_party_ids(p_room, 'in');
      v_arr := '[]'::jsonb; v_max := 0; v_cnt := 0;
      for v_x in select public.olnu_party_norm(i.val) as nk, min(i.val) as a, array_agg(i.user_id order by i.created_at) as ids, count(*)::int as n
                   from public.party_inputs i
                  where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk' and i.user_id = any (v_in)
                  group by 1 order by count(*) desc, min(i.created_at) loop
        v_arr := v_arr || jsonb_build_array(jsonb_build_object('a', v_x.a, 'n', v_x.n, 'who', public.olnu_party_people(p_room, v_x.ids)));
        if v_x.n > v_max then v_max := v_x.n; end if;
      end loop;
      select count(*) into v_cnt from jsonb_array_elements(v_arr) e where (e->>'n')::int = v_max;
      v_pub := v_pub || jsonb_build_object('herd', null, 'cow_k', null, 'cow_new', false);
      if v_max >= 2 and v_cnt = 1 then
        update public.party_players p set score = p.score + 1
          from jsonb_array_elements(v_arr->0->'who') w where p.room_id = p_room and p.k = w->>'k';
        v_pub := v_pub || jsonb_build_object('herd', 0);
      end if;
      select count(*) into v_cnt from jsonb_array_elements(v_arr) e where (e->>'n')::int = 1;
      if v_cnt = 1 and jsonb_array_length(v_arr) >= 2 then
        select e->'who'->0->>'k' into v_s from jsonb_array_elements(v_arr) e where (e->>'n')::int = 1;
        v_cow := public.olnu_party_uid(p_room, v_s);
        v_sec := v_sec || jsonb_build_object('cow', v_cow);
        v_pub := v_pub || jsonb_build_object('cow_k', v_s, 'cow_name', public.olnu_party_pname(p_room, v_cow), 'cow_new', true);
      end if;
      v_phase := 'score';
      v_pub := v_pub || jsonb_build_object('rk', null, 'groups', v_arr);
    elsif r.phase = 'score' then
      if r.round >= coalesce((v_pub->>'rounds')::int, 1) then
        v_phase := 'end';
        v_pub := v_pub || jsonb_build_object('rk', null,
          'winners', public.olnu_party_finish(p_room, public.olnu_party_top(p_room, (r.sec->>'cow')::uuid)));
      else
        v_round := r.round + 1;
        v_phase := 'write';
        v_pub := v_pub || jsonb_build_object('rk', 'ans:' || v_round, 'prompt', r.sec->'list'->>(v_round - 1), 'groups', null, 'herd', null, 'cow_new', false);
      end if;
    end if;

  /* ===== VÅGEN (wavelength) ===== */
  elsif r.game = 'vagen' then
    if r.phase = 'clue' then
      v_phase := 'guess';
      v_pub := v_pub || jsonb_build_object('rk', 'slide:' || r.round);
    elsif r.phase = 'guess' then
      v_tg := coalesce((r.sec->>'target')::int, 50);
      v_arr := '[]'::jsonb; v_sum := 0; v_cnt := 0;
      for v_x in select i.user_id, least(100, greatest(0, i.val::int)) as val from public.party_inputs i
                  where i.room_id = p_room and i.game_no = r.game_no and i.rk = r.pub->>'rk'
                    and i.user_id = any (public.olnu_party_need(p_room)) order by abs(i.val::int - v_tg) loop
        v_d := abs(v_x.val - v_tg);
        v_p := case when v_d <= 4 then 4 when v_d <= 9 then 3 when v_d <= 16 then 2 when v_d <= 25 then 1 else 0 end;
        v_sum := v_sum + v_p; v_cnt := v_cnt + 1;
        update public.party_players set score = score + v_p where room_id = p_room and user_id = v_x.user_id;
        v_arr := v_arr || jsonb_build_array(jsonb_build_object('k', public.olnu_party_k(p_room, v_x.user_id),
          'name', public.olnu_party_pname(p_room, v_x.user_id), 'val', v_x.val, 'pts', v_p));
      end loop;
      v_p := case when v_cnt > 0 then round(v_sum::numeric / v_cnt)::int else 0 end;
      update public.party_players set score = score + v_p where room_id = p_room and k = v_pub->>'psy_k';
      v_phase := 'score';
      v_pub := v_pub || jsonb_build_object('rk', null, 'target', v_tg, 'guesses', v_arr, 'psy_pts', v_p);
    elsif r.phase = 'score' then
      if r.round >= coalesce((v_pub->>'rounds')::int, 1) then
        v_phase := 'end';
        v_pub := v_pub || jsonb_build_object('rk', null, 'winners', public.olnu_party_finish(p_room, public.olnu_party_top(p_room)));
      else
        v_round := r.round + 1;
        v_list := r.sec->'list';
        -- next psychic: the next player in the order who is still here
        select e into v_arr from jsonb_array_elements(v_pub->'order') with ordinality as o(e, i)
         where exists (select 1 from public.party_players p where p.room_id = p_room and p.k = o.e->>'k' and p.status = 'in')
         order by ((o.i - 1) - ((v_round - 1) % greatest(1, jsonb_array_length(v_pub->'order'))) + 100) % 100 limit 1;
        v_s := v_list->>((v_round - 1) % greatest(1, jsonb_array_length(v_list)));
        v_sec := v_sec || jsonb_build_object('target', 5 + floor(random() * 91)::int);
        v_phase := 'clue';
        v_pub := v_pub || jsonb_build_object('rk', null, 'psy_k', v_arr->>'k', 'psy_name', v_arr->>'name', 'target', null, 'guesses', null,
          'scale', jsonb_build_array(split_part(v_s, '|', 1), coalesce(nullif(split_part(v_s, '|', 2), ''), '?')));
      end if;
    end if;
  end if;

  if v_phase is not distinct from r.phase and v_step = r.step and v_round = r.round and v_pub = r.pub then
    return false;
  end if;
  update public.party_rooms set phase = v_phase, round = v_round, step = v_step, pub = v_pub, sec = v_sec,
         v = v + 1, updated_at = now()
   where id = p_room;
  return true;
end; $$;

do $$
declare f text;
begin
  foreach f in array array['olnu_party_list(jsonb, integer, integer, integer)', 'olnu_party_need(uuid)',
    'olnu_party_top(uuid, uuid)', 'olnu_party_finish(uuid, uuid[])', 'olnu_party_start(uuid, jsonb)', 'olnu_party_next(uuid, boolean)']
  loop
    execute 'revoke all on function public.' || f || ' from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.' || f || ' from anon, authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.' || f || ' to service_role';
    end if;
  end loop;
end $$;
