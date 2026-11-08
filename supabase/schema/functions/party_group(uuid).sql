-- public.party_group(p_group_id uuid)
-- live md5(pg_get_functiondef) = 954c77567b683500d6cf61d8d82b86b4
CREATE OR REPLACE FUNCTION public.party_group(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.party_rooms; v_n int; v_in boolean; v_host text;
begin
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid)
     and not public.olnu_evg_member(p_group_id, v_uid) then
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
end; $function$;
