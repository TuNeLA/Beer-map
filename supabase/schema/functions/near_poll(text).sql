-- public.near_poll(p_name text)
-- live md5(pg_get_functiondef) = d2462ab181219d9ee1696ea9c96fd4c0
CREATE OR REPLACE FUNCTION public.near_poll(p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  s public.find_share; v_in jsonb; v_out jsonb; v_fr jsonb; v_sq jsonb;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into s from public.find_share x where x.user_id = v_uid;
  select coalesce(jsonb_agg(public.olnu_find_req_json(r, v_uid) order by r.created_at desc), '[]'::jsonb) into v_in
    from (select * from public.find_reqs x where x.to_uid = v_uid
             and (x.answer_by > now() - interval '10 minutes' or x.until > now()) order by x.created_at desc limit 10) r;
  select coalesce(jsonb_agg(public.olnu_find_req_json(r, v_uid) order by r.created_at desc), '[]'::jsonb) into v_out
    from (select * from public.find_reqs x where x.from_uid = v_uid
             and (x.answer_by > now() - interval '10 minutes' or x.until > now()) order by x.created_at desc limit 10) r;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', public.olnu_friend_name(f.requester),
           'home_town', public.olnu_home_town(f.requester), 'at', f.updated_at) order by f.updated_at desc), '[]'::jsonb) into v_fr
    from (select * from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'pending' and x.requester <> v_uid and (not public.olnu_is_test_user(x.requester) or public.olnu_is_test_user(v_uid))
           order by x.updated_at desc limit 10) f;
  begin
    v_sq := public.squad_poll() -> 'squads';
  exception when others then v_sq := '[]'::jsonb;
  end;
  return jsonb_build_object('v', 1, 'server_time', now(),
    'share', jsonb_build_object('groups', coalesce(s.groups and s.until > now(), false), 'friends', coalesce(s.friends and s.until > now(), false),
                                'until', case when s.until > now() then s.until end),
    'find_in', v_in, 'find_out', v_out, 'friends_in', v_fr, 'squads', coalesce(v_sq, '[]'::jsonb));
end; $function$;
