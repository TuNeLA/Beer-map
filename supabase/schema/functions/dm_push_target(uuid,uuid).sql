-- public.dm_push_target(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 0a5dedb8e894bdebb1429ba210442fd0
CREATE OR REPLACE FUNCTION public.dm_push_target(p_gid uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o uuid;
begin
  if not public.olnu_dm_is(p_gid) then return jsonb_build_object('dm', false); end if;
  v_o := public.olnu_dm_other(p_gid, p_uid);
  if v_o is null then return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'not_member'); end if;
  if public.olnu_dm_access(p_gid, p_uid) <> 'write' then return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'dm_closed'); end if;
  if exists (select 1 from public.dm_state s where s.group_id = p_gid and s.user_id = v_o and s.muted) then
    return jsonb_build_object('dm', true, 'to', '[]'::jsonb, 'reason', 'muted');
  end if;
  return jsonb_build_object('dm', true, 'to', jsonb_build_array(v_o),
    'name', coalesce(left(public.olnu_friend_name(p_uid), 24), 'Nån'));
end; $function$;
