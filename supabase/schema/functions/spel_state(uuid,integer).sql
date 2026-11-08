-- public.spel_state(p_room uuid, p_v integer)
-- live md5(pg_get_functiondef) = a40965061247a1ab118b49977f360afd
CREATE OR REPLACE FUNCTION public.spel_state(p_room uuid, p_v integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.spel_rooms; me public.spel_players;
begin
  select * into r from public.spel_rooms where id = p_room;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into me from public.spel_players where room_id = p_room and user_id = v_uid;
  if me.user_id is null or me.status <> 'in' then raise exception 'not_in_room'; end if;
  if r.closed or r.expires_at <= now() then return jsonb_build_object('closed', true, 'v', r.v, 'id', r.id); end if;
  if me.seen_at < now() - interval '10 seconds' then
    update public.spel_players set seen_at = now() where room_id = p_room and user_id = v_uid;
  end if;
  if r.phase in ('pick', 'vote') and r.updated_at < now() - interval '20 seconds' then
    perform public.olnu_spel_auto(p_room);
    select * into r from public.spel_rooms where id = p_room;
  end if;
  if coalesce(p_v, 0) = r.v then return jsonb_build_object('same', true, 'v', r.v); end if;
  return public.olnu_spel_view(p_room, v_uid);
end; $function$;
