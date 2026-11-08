-- public.olnu_spel_round(p_room uuid)
-- live md5(pg_get_functiondef) = a9953f161129e66cf76ebbcb4088a704
CREATE OR REPLACE FUNCTION public.olnu_spel_round(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.spel_rooms; v_j uuid; v_jn text; v_jo int; v_bl int[]; v_b int; v_nb int; v_pick int;
  v_np int; v_dk int[]; v_p int; v_key text;
begin
  select * into r from public.spel_rooms where id = p_room for update;
  if r.game = 'kort' then
    v_jo := coalesce((r.sec->>'jord')::int, -1);
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
end; $function$;
