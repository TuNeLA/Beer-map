-- public.send_tip(p_group_id uuid, p_bar_id text, p_bar_name text, p_body text)
-- live md5(pg_get_functiondef) = e7af307f973817d30837a6042bda6d12
CREATE OR REPLACE FUNCTION public.send_tip(p_group_id uuid, p_bar_id text, p_bar_name text, p_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := public.olnu_bp_clean(p_bar_id);
  v_bar  text := public.olnu_bp_clean(p_bar_name);
  v_body text := nullif(public.olnu_bp_clean(p_body), '');
  v_name text;
  v_last timestamptz;
  v_msg  text;
  v_mid  bigint;
  v_tid  bigint;
begin
  select m.display_name into v_name from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid;
  if not found then raise exception 'not_member'; end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_bar) < 1 or char_length(v_bar) > 60 then
    raise exception 'invalid_bar';
  end if;
  if v_body is not null and (char_length(v_body) > 40 or public.olnu_bp_blocked(v_body)) then
    raise exception 'invalid_msg';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_tip:' || v_uid::text, 0));
  select max(t.created_at) into v_last from public.bar_tips t
   where t.user_id = v_uid and t.created_at > now() - interval '5 minutes';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'id', null, 'msg_id', null,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '5 minutes' - now())))::int));
  end if;

  v_msg := left('📣 ' || coalesce(v_name, 'Någon') || ' tipsar: Kom till ' || v_bar || '!' ||
                coalesce(' ' || v_body, ''), 140);
  insert into public.group_msgs (group_id, user_id, body, expires_at)
  values (p_group_id, v_uid, v_msg, public.olnu_next_expiry())
  returning id into v_mid;
  insert into public.bar_tips (user_id, group_id, bar_id, bar_name, body, msg_id)
  values (v_uid, p_group_id, v_id, v_bar, v_body, v_mid)
  returning id into v_tid;
  return jsonb_build_object('ok', true, 'wait_seconds', 0, 'id', v_tid, 'msg_id', v_mid);
end;
$function$;
