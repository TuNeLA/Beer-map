-- public.olnu_evgo_circle(p_uid uuid)
-- live md5(pg_get_functiondef) = baed26d98cdd977afb13f1ac8875054b
CREATE OR REPLACE FUNCTION public.olnu_evgo_circle(p_uid uuid)
 RETURNS TABLE(uid uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct x.uid from (
    select public.olnu_friend_other(f, p_uid) as uid
      from public.friendships f
     where (f.a = p_uid or f.b = p_uid) and f.status = 'accepted'
    union
    select gm2.user_id
      from public.group_members gm
      join public.group_members gm2 on gm2.group_id = gm.group_id
     where gm.user_id = p_uid and gm2.user_id <> p_uid
  ) x
  where x.uid is not null and x.uid <> p_uid
  limit 2000;
$function$;
