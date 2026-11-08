-- public.add_quote(p_group_id uuid, p_who text, p_body text, p_msg_id bigint)
-- live md5(pg_get_functiondef) = cd67f4984e15ae482aa86de2c441c781
CREATE OR REPLACE FUNCTION public.add_quote(p_group_id uuid, p_who text, p_body text, p_msg_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_who text := public.olnu_gang_clean(p_who);
  v_body text := public.olnu_gang_clean(p_body);
  v_night timestamptz := public.olnu_night_of(now());
  m public.group_msgs;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_msg_id is not null then
    select * into m from public.group_msgs x where x.id = p_msg_id and x.group_id = p_group_id;
    if found then
      v_body := public.olnu_gang_clean(m.body);
      v_who := coalesce(public.olnu_gang_name(p_group_id, m.user_id), v_who);
    end if;
  end if;
  v_body := btrim(v_body, ' "”“');
  if v_who = '' or char_length(v_who) > 30 or v_body = '' or char_length(v_body) > 140 then raise exception 'invalid_quote'; end if;
  perform public.olnu_gang_rl('q:' || v_uid::text);
  if exists (select 1 from public.gang_quotes q where q.user_id = v_uid and q.created_at > now() - interval '8 seconds') then
    raise exception 'slow_down';
  end if;
  if (select count(*) from public.gang_quotes q where q.user_id = v_uid and q.night = v_night) >= 40 then
    raise exception 'slow_down';
  end if;
  select q.id into v_id from public.gang_quotes q
   where q.group_id = p_group_id and q.night = v_night and lower(q.body) = lower(v_body) and lower(q.who) = lower(v_who) and not q.hidden
   limit 1;
  if v_id is null then
    insert into public.gang_quotes (group_id, user_id, who, body, msg_id, night, reveal_at)
    values (p_group_id, v_uid, v_who, v_body, case when m.id is not null then m.id end, v_night, public.olnu_gang_reveal(v_night))
    returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'reveal_at', public.olnu_gang_reveal(v_night), 'who', v_who, 'body', v_body);
end; $function$;
