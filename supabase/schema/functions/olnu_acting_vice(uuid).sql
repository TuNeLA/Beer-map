-- public.olnu_acting_vice(p_group uuid)
-- live md5(pg_get_functiondef) = 4981fd38200894dd677f3529cb9d51f9
CREATE OR REPLACE FUNCTION public.olnu_acting_vice(p_group uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.user_id from public.group_vices v
    join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id and m.joined_at = v.member_since
   where v.group_id = p_group and v.active and public.olnu_chief_idle(p_group)
     and v.user_id is distinct from public.olnu_chief_of(p_group)
     and coalesce(public.olnu_seen_at(p_group, v.user_id) >= now() - interval '12 hours', false)
   order by v.updated_at, v.user_id
   limit 1;
$function$;
