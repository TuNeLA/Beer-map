-- public.group_status_v2(p_group_id uuid)
-- live md5(pg_get_functiondef) = af9534bd75eb739aac76a38a529b4dd5
CREATE OR REPLACE FUNCTION public.group_status_v2(p_group_id uuid)
 RETURNS TABLE(name text, beers integer, others integer, other_kind text, live boolean, total integer, is_me boolean, k text, is_owner boolean, is_chief boolean, is_vice boolean, is_acting boolean, home_town text, can_remove boolean, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_chief uuid;
  v_owner uuid;
  v_act   uuid;
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  v_chief := public.olnu_chief_of(p_group_id);
  v_owner := public.olnu_owner_of(p_group_id);
  v_act := public.olnu_acting_vice(p_group_id);
  return query
  select gm.display_name,
         coalesce(case when b.expires_at > now() then b.beer_count end, 0)::int,
         coalesce(case when b.expires_at > now() then b.other_count end, 0)::int,
         case when b.expires_at > now() then b.other_kind end,
         coalesce(b.expires_at > now() and not b.stopped, false),
         public.olnu_lifetime(gm.user_id),
         (gm.user_id = v_uid),
         public.olnu_chief_k(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_owner, false),
         coalesce(gm.user_id = v_chief, false),
         public.olnu_is_vice(p_group_id, gm.user_id),
         coalesce(gm.user_id = v_act, false),
         public.olnu_home_town(gm.user_id),
         public.olnu_remove_block(p_group_id, v_uid, gm.user_id) is null,
         gm.joined_at
    from public.group_members gm
    left join public.beers b on b.user_id = gm.user_id
   where gm.group_id = p_group_id
   order by 2 desc, 3 desc, 1;
end; $function$;
