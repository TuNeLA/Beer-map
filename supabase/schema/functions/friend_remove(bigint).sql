-- public.friend_remove(p_id bigint)
-- live md5(pg_get_functiondef) = b5bef40ed45ab094c291853555b32642
CREATE OR REPLACE FUNCTION public.friend_remove(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  f public.friendships;
begin
  select * into f from public.friendships x where x.id = p_id and (x.a = v_uid or x.b = v_uid) for update;
  if f.id is null then raise exception 'friend_req_not_found'; end if;
  if f.status = 'accepted' then
    update public.friendships x set status = 'removed', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  elsif f.status = 'pending' and f.requester = v_uid then
    update public.friendships x set status = 'cancelled', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  elsif f.status = 'pending' then
    update public.friendships x set status = 'declined', updated_at = now(), ended_by = v_uid where x.id = f.id returning * into f;
  end if;
  return jsonb_build_object('id', f.id, 'status', f.status);
end; $function$;
