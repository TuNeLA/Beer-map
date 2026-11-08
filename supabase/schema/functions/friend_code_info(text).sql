-- public.friend_code_info(p_code text)
-- live md5(pg_get_functiondef) = 433d2c75a2c4f346944c586c1fdad746
CREATE OR REPLACE FUNCTION public.friend_code_info(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_t uuid; f public.friendships;
begin
  select c.user_id into v_t from public.friend_codes c where c.code = v_code;
  if v_t is null then raise exception 'friend_not_found'; end if;
  select * into f from public.friendships x
   where least(x.a, x.b) = least(v_uid, v_t) and greatest(x.a, x.b) = greatest(v_uid, v_t);
  return jsonb_build_object('name', public.olnu_friend_name(v_t), 'home_town', public.olnu_home_town(v_t),
    'mine', v_t = v_uid,
    'state', case when f.id is null or f.status not in ('pending', 'accepted') then 'none'
                  when f.status = 'accepted' then 'accepted'
                  when f.requester = v_uid then 'pending_out' else 'pending_in' end);
end; $function$;
