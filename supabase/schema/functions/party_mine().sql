-- public.party_mine()
-- live md5(pg_get_functiondef) = 4cedba2ee4e1a842603aac5c98bc1914
CREATE OR REPLACE FUNCTION public.party_mine()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v jsonb;
begin
  select jsonb_build_object('id', r.id, 'code', r.code, 'game', r.game, 'phase', r.phase, 'is_host', r.host = v_uid, 'group_id', r.group_id)
    into v
    from public.party_players p join public.party_rooms r on r.id = p.room_id
   where p.user_id = v_uid and p.status <> 'left' and not r.closed and r.expires_at > now()
   order by p.joined_at desc limit 1;
  return jsonb_build_object('room', v);
end; $function$;
