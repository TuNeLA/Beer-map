-- public.msg_likes(p_group_id uuid)
-- live md5(pg_get_functiondef) = 8153f780b58740139e5e353a5e9b7309
CREATE OR REPLACE FUNCTION public.msg_likes(p_group_id uuid)
 RETURNS TABLE(msg_id bigint, likes integer, liked boolean, names text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_temp boolean := public.olnu_is_temp_group(p_group_id);
begin
  if not public.olnu_chat_can(p_group_id, v_uid, false) then
    raise exception 'not_member';
  end if;
  return query
  select l.msg_id, count(*)::int, bool_or(l.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(l.user_id) end, '?') order by l.created_at)
    from public.group_msg_likes l
    join public.group_msgs gm on gm.id = l.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = l.user_id
   where l.liked
   group by l.msg_id;
end;
$function$;
COMMENT ON FUNCTION public.msg_likes(p_group_id uuid) IS 'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.';
