-- public.olnu_spel_deal(p_room uuid)
-- live md5(pg_get_functiondef) = 14eeeb118474ecba50b71efc2821a6aa
CREATE OR REPLACE FUNCTION public.olnu_spel_deal(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.spel_rooms; v_deck int[]; v_nw int; p record; v_need int; v_held int[];
begin
  select * into r from public.spel_rooms where id = p_room for update;
  v_nw := coalesce((r.sec->'cfg'->>'nw')::int, 0);
  if r.game <> 'kort' or v_nw < 10 then return; end if;
  v_deck := coalesce(array(select x::int from jsonb_array_elements_text(coalesce(r.sec->'white', '[]'::jsonb)) x), '{}'::int[]);
  for p in select user_id, hand from public.spel_players where room_id = p_room and status = 'in' order by ord loop
    v_need := 7 - coalesce(cardinality(p.hand), 0);
    if v_need <= 0 then continue; end if;
    if coalesce(cardinality(v_deck), 0) < v_need then
      v_held := coalesce(array(select unnest(s.hand) from public.spel_players s where s.room_id = p_room and s.status = 'in'), '{}'::int[]);
      v_deck := v_deck || public.olnu_spel_deck(v_nw, v_held || v_deck);
    end if;
    update public.spel_players set hand = hand || v_deck[1:v_need] where room_id = p_room and user_id = p.user_id;
    v_deck := coalesce(v_deck[v_need + 1:], '{}'::int[]);
  end loop;
  update public.spel_rooms set sec = jsonb_set(sec, '{white}', to_jsonb(v_deck)) where id = p_room;
end; $function$;
