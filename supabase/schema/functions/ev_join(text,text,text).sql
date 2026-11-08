-- public.ev_join(p_token text, p_answer text, p_name text)
-- live md5(pg_get_functiondef) = cf614e7895a6069d29b1e143ef202c8b
CREATE OR REPLACE FUNCTION public.ev_join(p_token text, p_answer text DEFAULT 'yes'::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_a text := lower(coalesce(p_answer, 'yes'));
  l public.ev_links;
  i public.invites;
  v_old text;
  r jsonb;
begin
  if v_a not in ('yes', 'maybe', 'no') then raise exception 'invalid_answer'; end if;
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    raise exception 'slow_down';
  end if;
  select * into l from public.ev_links x where x.token = v_t and x.expires_at > now();
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    raise exception 'invite_not_found';
  end if;
  select * into i from public.invites x where x.id = l.invite_id;
  if i.id is null then raise exception 'invite_not_found'; end if;
  if i.status <> 'open' or i.ends_at <= now() then raise exception 'invite_over'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if public.olnu_friend_name(v_uid) is null then raise exception 'name_needed'; end if;
  select p.answer into v_old from public.invite_people p where p.invite_id = i.id and p.user_id = v_uid;
  if v_old is null then
    if (select count(*) from public.invite_people p where p.invite_id = i.id) >= 61 then raise exception 'too_many'; end if;
    if (select count(*) from public.invite_people p where p.user_id = v_uid and p.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'slow_down';
    end if;
    insert into public.invite_people (invite_id, user_id, invited_by, answer, notified)
    values (i.id, v_uid, l.creator, 'none', true);
    update public.ev_links x set joins = x.joins + 1 where x.token = l.token;
  end if;
  r := public.invite_answer(i.id, v_a);
  return r || jsonb_build_object('token', l.token, 'faces', public.olnu_ev_faces(i.id));
end;
$function$;
