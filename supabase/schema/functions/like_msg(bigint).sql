-- public.like_msg(p_msg_id bigint)
-- live md5(pg_get_functiondef) = 67282238fdb2336b31d61800ce117a70
CREATE OR REPLACE FUNCTION public.like_msg(p_msg_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_liked boolean;
  v_n int;
begin
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not public.olnu_chat_can(v_gid, v_uid, true) then
    raise exception 'not_member';
  end if;
  insert into public.group_msg_likes as l (msg_id, user_id, liked) values (p_msg_id, v_uid, true)
  on conflict (msg_id, user_id) do update set liked = not l.liked, created_at = now()
  returning l.liked into v_liked;
  select count(*) into v_n from public.group_msg_likes where msg_id = p_msg_id and liked;
  return jsonb_build_object('likes', v_n, 'liked', v_liked);
end;
$function$;
COMMENT ON FUNCTION public.like_msg(p_msg_id bigint) IS 'DEPRECATED 2026-11-07: no caller in the app any more (old clients only). Drop after 30 days with 0 calls.';
