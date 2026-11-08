-- public.olnu_friend_name(p_uid uuid)
-- live md5(pg_get_functiondef) = 369c2cb44eb83bbb2ceb1f1a9b769a12
CREATE OR REPLACE FUNCTION public.olnu_friend_name(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select n.name from public.user_names n where n.user_id = p_uid),
                  (select min(gm.display_name) from public.group_members gm where gm.user_id = p_uid));
$function$;
