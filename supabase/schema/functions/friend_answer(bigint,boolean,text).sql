-- public.friend_answer(p_id bigint, p_accept boolean, p_name text)
-- live md5(pg_get_functiondef) = 59d8a6b6234a444dae4afbb6cc075379
CREATE OR REPLACE FUNCTION public.friend_answer(p_id bigint, p_accept boolean, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  f public.friendships;
begin
  perform public.olnu_friend_setname(v_uid, p_name);
  select * into f from public.friendships x where x.id = p_id and (x.a = v_uid or x.b = v_uid) for update;
  if f.id is null or f.status <> 'pending' or f.requester = v_uid then raise exception 'friend_req_not_found'; end if;
  if coalesce(p_accept, false) then
    if (select count(*) from public.friendships x where (x.a = v_uid or x.b = v_uid) and x.status = 'accepted') >= 300 then
      raise exception 'friend_limit';
    end if;
    update public.friendships x set status = 'accepted', accepted_at = now(), updated_at = now() where x.id = f.id returning * into f;
  else
    update public.friendships x set status = 'declined', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', f.status, 'name', public.olnu_friend_name(public.olnu_friend_other(f, v_uid)));
end; $function$;
