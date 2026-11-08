-- public.olnu_evg_people(p_gid uuid)
-- live md5(pg_get_functiondef) = 757032ad3c178b6cfe88e542ad0cca6c
CREATE OR REPLACE FUNCTION public.olnu_evg_people(p_gid uuid)
 RETURNS TABLE(user_id uuid, name text, answer text, creator boolean, ord timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.user_id, coalesce(public.olnu_friend_name(p.user_id), '?'), p.answer, p.user_id = i.creator,
         coalesce(p.answered_at, p.created_at)
    from public.temp_groups t
    join public.invites i on i.id = t.invite_id
    join public.invite_people p on p.invite_id = i.id
   where t.group_id = p_gid and (p.answer in ('yes', 'maybe') or p.user_id = i.creator);
$function$;
