-- public.olnu_spel_close(p_room uuid)
-- live md5(pg_get_functiondef) = ef5ba98e01c27503d85bb42c2c7b7d45
CREATE OR REPLACE FUNCTION public.olnu_spel_close(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    else
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
end; $function$;
