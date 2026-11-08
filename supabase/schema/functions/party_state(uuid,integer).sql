-- public.party_state(p_room uuid, p_v integer)
-- live md5(pg_get_functiondef) = b0c16f2b9bc99324db4ce6555f36f0e3
CREATE OR REPLACE FUNCTION public.party_state(p_room uuid, p_v integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end; $function$;
