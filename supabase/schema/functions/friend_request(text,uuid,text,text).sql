-- public.friend_request(p_code text, p_group_id uuid, p_k text, p_name text)
-- live md5(pg_get_functiondef) = 983ab676caa56d3841e4517575e3a89b
CREATE OR REPLACE FUNCTION public.friend_request(p_code text DEFAULT NULL::text, p_group_id uuid DEFAULT NULL::uuid, p_k text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_t uuid; v_via text := 'code';
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_group_id is not null then
    v_via := 'group';
    if not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    select gm.user_id into v_t from public.group_members gm
     where gm.group_id = p_group_id
       and (public.olnu_chief_k(p_group_id, gm.user_id) = btrim(coalesce(p_k, '')));
    if v_t is null then raise exception 'invalid_member'; end if;
  else
    select c.user_id into v_t from public.friend_codes c where c.code = v_code;
    if v_t is null then raise exception 'friend_not_found'; end if;
  end if;
  if v_t = v_uid then raise exception 'own_code'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_friend:' || least(v_uid, v_t)::text || greatest(v_uid, v_t)::text, 0));
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);
  if f.id is not null and f.status = 'accepted' then
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if f.id is not null and f.status = 'pending' and f.requester = v_uid then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
    raise exception 'friend_limit';
  end if;
  if f.id is not null and f.status = 'pending' then
    update public.friendships x set status = 'accepted', accepted_at = now(), updated_at = now()
     where x.id = f.id returning * into f;
    return jsonb_build_object('id', f.id, 'status', 'accepted', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', true);
  end if;
  if f.id is not null and f.status = 'declined' and f.requester = v_uid and f.updated_at > now() - interval '24 hours' then
    return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', true, 'auto', false);
  end if;
  if (select count(*) from public.friendships x where x.requester = v_uid and x.updated_at > now() - interval '1 hour'
        and x.status in ('pending', 'cancelled', 'declined')) >= 30 then
    raise exception 'slow_down';
  end if;
  if f.id is not null then
    update public.friendships x set status = 'pending', requester = v_uid, via = v_via,
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(),
           accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', v_via) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_friend_name(v_t), 'already', false, 'auto', false);
end; $function$;
