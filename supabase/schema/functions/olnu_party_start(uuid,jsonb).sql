-- public.olnu_party_start(p_room uuid, p_data jsonb)
-- live md5(pg_get_functiondef) = 41ddd48a86aae07502384d9efaeab1c4
CREATE OR REPLACE FUNCTION public.olnu_party_start(p_room uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  else
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
end; $function$;
