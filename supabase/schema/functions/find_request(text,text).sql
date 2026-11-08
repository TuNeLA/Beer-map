-- public.find_request(p_key text, p_name text)
-- live md5(pg_get_functiondef) = 226ad7a63d305d576449d251c6a92d00
CREATE OR REPLACE FUNCTION public.find_request(p_key text, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t record; r public.find_reqs; v_auto boolean; v_end timestamptz := public.olnu_next_expiry();
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into t from public.olnu_find_resolve(p_key, v_uid);
  perform pg_advisory_xact_lock(hashtextextended('olnu_find:' || least(v_uid, t.uid)::text || greatest(v_uid, t.uid)::text, 0));
  r := public.olnu_find_live(v_uid, t.uid);
  if r.id is not null and r.status = 'pending' and r.to_uid = v_uid then
    update public.find_reqs x set status = 'accepted', answered_at = now(), until = least(now() + interval '30 minutes', v_end)
     where x.id = r.id returning * into r;
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', false, 'allowed', true);
  end if;
  if r.id is not null then
    return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', r.status = 'auto', 'allowed', public.olnu_find_allowed(v_uid, t.uid));
  end if;
  if exists (select 1 from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '15 seconds')
     or (select count(*) from public.find_reqs x where x.from_uid = v_uid and x.created_at > now() - interval '12 hours') >= 60
     or (select count(*) from public.find_reqs x where x.from_uid = v_uid and x.to_uid = t.uid
          and x.created_at > now() - interval '30 minutes') >= 3 then
    raise exception 'slow_down';
  end if;
  v_auto := exists (select 1 from public.find_share s where s.user_id = t.uid and s.until > now()
                     and ((s.friends and public.olnu_are_friends(v_uid, t.uid)) or (s.groups and public.olnu_share_group(v_uid, t.uid))));
  insert into public.find_reqs (from_uid, to_uid, group_id, friendship_id, status, until, answered_at)
  values (v_uid, t.uid, t.group_id, t.friendship_id, case when v_auto then 'auto' else 'pending' end,
          case when v_auto then least(now() + interval '30 minutes', v_end) end, case when v_auto then now() end)
  returning * into r;
  return public.olnu_find_req_json(r, v_uid) || jsonb_build_object('auto', v_auto, 'allowed', public.olnu_find_allowed(v_uid, t.uid));
end; $function$;
