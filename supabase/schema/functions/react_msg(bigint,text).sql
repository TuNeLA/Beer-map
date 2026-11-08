-- public.react_msg(p_msg_id bigint, p_emoji text)
-- live md5(pg_get_functiondef) = 7491647463e25d17d7fe8b3da095e242
CREATE OR REPLACE FUNCTION public.react_msg(p_msg_id bigint, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_gid uuid;
  v_old text;
  v_act boolean;
begin
  if p_emoji not in ('🍻','😂','🔥','❤️') then raise exception 'invalid_emoji'; end if;
  select gm.group_id into v_gid from public.group_msgs gm where gm.id = p_msg_id and gm.expires_at > now();
  if v_gid is null then raise exception 'msg_not_found'; end if;
  if not public.olnu_chat_can(v_gid, v_uid, true) then
    raise exception 'not_member';
  end if;
  select r.emoji, r.active into v_old, v_act from public.group_msg_reacts r where r.msg_id = p_msg_id and r.user_id = v_uid;
  if v_old is null then
    insert into public.group_msg_reacts (msg_id, user_id, emoji) values (p_msg_id, v_uid, p_emoji);
    return jsonb_build_object('emoji', p_emoji);
  elsif v_old = p_emoji and v_act then
    update public.group_msg_reacts set active = false, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', null);
  else
    update public.group_msg_reacts set emoji = p_emoji, active = true, created_at = now() where msg_id = p_msg_id and user_id = v_uid;
    return jsonb_build_object('emoji', p_emoji);
  end if;
end;
$function$;
