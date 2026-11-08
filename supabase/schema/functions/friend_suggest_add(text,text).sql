-- public.friend_suggest_add(p_k text, p_name text)
-- live md5(pg_get_functiondef) = 7e508e166bb47afc3e9a653f1dd6b6e2
CREATE OR REPLACE FUNCTION public.friend_suggest_add(p_k text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_k text := left(regexp_replace(coalesce(p_k, ''), '[^0-9a-f]', '', 'g'), 16);
  v_t uuid; v_g text;
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select r.uid, r.g into v_t, v_g from public.olnu_sug_rows2(v_uid) r where public.olnu_sug_k(v_uid, r.uid) = v_k limit 1;
  if v_t is null then raise exception 'invalid_target'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_friend:' || least(v_uid, v_t)::text || greatest(v_uid, v_t)::text, 0));
  if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
    raise exception 'friend_limit';
  end if;
  if (select count(*) from public.friendships x where x.requester = v_uid and x.updated_at > now() - interval '1 hour'
        and x.status in ('pending', 'cancelled', 'declined')) >= 30 then
    raise exception 'slow_down';
  end if;
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);
  if f.id is not null then
    update public.friendships x set status = 'pending', requester = v_uid, via = case when v_g is not null then 'group' else 'code' end,
           notified = (x.updated_at > now() - interval '24 hours'), updated_at = now(), accepted_at = null, ended_by = null
     where x.id = f.id returning * into f;
  else
    insert into public.friendships (a, b, requester, status, via)
    values (least(v_uid, v_t), greatest(v_uid, v_t), v_uid, 'pending', case when v_g is not null then 'group' else 'code' end) returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', 'pending', 'name', public.olnu_card_first(public.olnu_friend_name(v_t)));
end;
$function$;
