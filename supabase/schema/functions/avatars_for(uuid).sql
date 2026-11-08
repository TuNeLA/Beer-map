-- public.avatars_for(p_group_id uuid)
-- live md5(pg_get_functiondef) = 947d9dbd86144fe37804d14b97896bb0
CREATE OR REPLACE FUNCTION public.avatars_for(p_group_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v jsonb; v_temp boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null then
    with u as (
      select v_uid as uid
      union
      select case when f.a = v_uid then f.b else f.a end from public.friendships f
       where (f.a = v_uid or f.b = v_uid) and f.status = 'accepted'
      limit 300
    )
    select coalesce(jsonb_agg(jsonb_build_object('k', case when u.uid = v_uid then 'me' else public.olnu_inv_key(v_uid, u.uid) end,
             'name', public.olnu_friend_name(u.uid), 'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
      into v from u where u.uid is not null and not public.olnu_ub_hidden(v_uid, u.uid);
    return jsonb_build_object('v', 1, 'people', v);
  end if;
  if not public.olnu_chat_can(p_group_id, v_uid, false) then raise exception 'not_member'; end if;
  v_temp := public.olnu_is_temp_group(p_group_id);
  with u as (
    select m.user_id as uid from public.group_members m where m.group_id = p_group_id
    union select t.a from public.dm_threads t where t.group_id = p_group_id
    union select t.b from public.dm_threads t where t.group_id = p_group_id
    union select gm.user_id from public.group_msgs gm where gm.group_id = p_group_id and gm.expires_at > now()
    union select v_uid
    limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'k', public.olnu_chief_k(p_group_id, u.uid),
           'name', coalesce((select mm.display_name from public.group_members mm where mm.group_id = p_group_id and mm.user_id = u.uid),
                            case when v_temp then public.olnu_friend_name(u.uid) end),
           'is_me', u.uid = v_uid) || public.olnu_avatar_pub(u.uid)), '[]'::jsonb)
    into v from u where u.uid is not null and not public.olnu_ub_hidden(v_uid, u.uid);
  return jsonb_build_object('v', 1, 'people', v);
end; $function$;
