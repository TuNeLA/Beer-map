-- public.group_friend_states(p_group_id uuid)
-- live md5(pg_get_functiondef) = bfa01bdedf0d713eb0e977229a01af44
CREATE OR REPLACE FUNCTION public.group_friend_states(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_group_id is null or not exists (select 1 from public.group_members gm where gm.group_id = p_group_id and gm.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('k', public.olnu_chief_k(p_group_id, m.user_id), 'name', m.display_name,
           's', case when f.status = 'accepted' then 'friend'
                     when f.status = 'pending' and f.requester = v_uid then 'out'
                     when f.status = 'pending' then 'in'
                     else 'none' end)), '[]'::jsonb)
    into v
    from public.group_members m
    left join public.friendships f
      on least(f.a, f.b) = least(v_uid, m.user_id) and greatest(f.a, f.b) = greatest(v_uid, m.user_id)
   where m.group_id = p_group_id and m.user_id <> v_uid;
  return jsonb_build_object('v', 1, 'states', v);
end $function$;
