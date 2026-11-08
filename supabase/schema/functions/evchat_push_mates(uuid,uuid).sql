-- public.evchat_push_mates(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = bf111141b350df34489b7e1697375e70
CREATE OR REPLACE FUNCTION public.evchat_push_mates(p_gid uuid, p_uid uuid)
 RETURNS TABLE(user_id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.user_id, coalesce(public.olnu_friend_name(p_uid), 'Nån')
    from public.temp_groups t
    join public.invite_people p on p.invite_id = t.invite_id
   where t.group_id = p_gid
     and public.olnu_tg_access(p_gid, p_uid) = 'write'
     and p.answer in ('yes', 'maybe') and p.user_id <> p_uid;
$function$;
