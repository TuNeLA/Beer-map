-- public.olnu_dm_json(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = ceb60800c433f65a5f6c4975ebcc5aad
CREATE OR REPLACE FUNCTION public.olnu_dm_json(p_gid uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o uuid := public.olnu_dm_other(p_gid, p_uid);
  v_me public.dm_state;
  v_ot public.dm_state;
begin
  if v_o is null then return null; end if;
  select * into v_me from public.dm_state s where s.group_id = p_gid and s.user_id = p_uid;
  select * into v_ot from public.dm_state s where s.group_id = p_gid and s.user_id = v_o;
  return jsonb_build_object(
    'group_id', p_gid,
    'name', coalesce(left(public.olnu_friend_name(v_o), 40), '?'),
    'home_town', public.olnu_home_town(v_o),
    'can_write', public.olnu_dm_access(p_gid, p_uid) = 'write',
    'friends', public.olnu_dm_friends(p_uid, v_o),
    'blocked_by_me', exists (select 1 from public.dm_blocks k where k.blocker = p_uid and k.blocked = v_o and k.active),
    'blocked_me', exists (select 1 from public.dm_blocks k where k.blocker = v_o and k.blocked = p_uid and k.active),
    'muted', coalesce(v_me.muted, false),
    'my_seen_id', coalesce(v_me.seen_id, 0),
    -- "Sett": hidden while a block is on (either way)
    'other_seen_id', case when public.olnu_dm_blocked(p_uid, v_o) then 0 else coalesce(v_ot.seen_id, 0) end,
    'other_seen_at', case when public.olnu_dm_blocked(p_uid, v_o) then null else v_ot.seen_at end);
end; $function$;
