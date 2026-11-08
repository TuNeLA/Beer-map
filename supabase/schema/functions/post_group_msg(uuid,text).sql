-- public.post_group_msg(p_group_id uuid, p_body text)
-- live md5(pg_get_functiondef) = 0aef9041833f4375602b1ef33ab6a14e
CREATE OR REPLACE FUNCTION public.post_group_msg(p_group_id uuid, p_body text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := btrim(replace(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'), chr(8291), ''));
  v_id bigint; v_at timestamptz;
begin
  if not public.olnu_chat_can(p_group_id, v_uid, true) then
    raise exception 'not_member';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 140 then raise exception 'invalid_msg'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_msg:' || v_uid::text, 0));
  -- Chat like other apps: no wait between messages. Only a flood guard (max 10 messages per 20 s).
  if (select count(*) from public.group_msgs m where m.user_id = v_uid and m.created_at > now() - interval '20 seconds') >= 10 then
    raise exception 'slow_down';
  end if;
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_body, public.olnu_next_expiry())
  returning group_msgs.id, group_msgs.created_at into v_id, v_at;
  return json_build_object('id', v_id, 'created_at', v_at);
end; $function$;
