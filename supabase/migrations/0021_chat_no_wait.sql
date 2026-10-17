-- 0021 Chat without waiting: the 20 s wait between messages is gone. Flood guard only: max 10 messages per 20 s.
create or replace function public.post_group_msg(p_group_id uuid, p_body text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := public.olnu_uid();
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'));
  v_id bigint; v_at timestamptz;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
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
