-- public.msg_reacts(p_group_id uuid)
-- live md5(pg_get_functiondef) = 982b4272139d18268ff37292e78c4538
CREATE OR REPLACE FUNCTION public.msg_reacts(p_group_id uuid)
 RETURNS TABLE(msg_id bigint, emoji text, n integer, mine boolean, names text[])
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
  select r.msg_id, r.emoji, count(*)::int, bool_or(r.user_id = v_uid),
         array_agg(coalesce(mm.display_name, case when v_temp then public.olnu_friend_name(r.user_id) end, '?') order by r.created_at)
    from public.group_msg_reacts r
    join public.group_msgs gm on gm.id = r.msg_id and gm.group_id = p_group_id and gm.expires_at > now()
    left join public.group_members mm on mm.group_id = p_group_id and mm.user_id = r.user_id
   where r.active
   group by r.msg_id, r.emoji;
end;
$function$;
