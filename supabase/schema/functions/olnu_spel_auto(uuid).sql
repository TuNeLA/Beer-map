-- public.olnu_spel_auto(p_room uuid)
-- live md5(pg_get_functiondef) = e702a8a0d613b529c94dfba5c75d2b18
CREATE OR REPLACE FUNCTION public.olnu_spel_auto(p_room uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.spel_rooms; v_need uuid[]; v_done uuid[];
begin
  select * into r from public.spel_rooms where id = p_room;
  if r.phase not in ('pick', 'vote') then return; end if;
  v_need := public.olnu_spel_active(p_room);
  if r.phase = 'pick' then v_need := array_remove(v_need, (r.sec->>'judge')::uuid); end if;
  v_done := coalesce(array(select i.user_id from public.spel_inputs i where i.room_id = p_room and i.game_no = r.game_no and i.round = r.round), '{}'::uuid[]);
  if cardinality(v_done) > 0 and v_need <@ v_done then perform public.olnu_spel_close(p_room); end if;
end; $function$;
