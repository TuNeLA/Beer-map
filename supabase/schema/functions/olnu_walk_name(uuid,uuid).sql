-- public.olnu_walk_name(p_uid uuid, p_group uuid)
-- live md5(pg_get_functiondef) = daa6ca86ae98c4f60fa995b8f8fdf41e
CREATE OR REPLACE FUNCTION public.olnu_walk_name(p_uid uuid, p_group uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
    public.olnu_friend_name(p_uid), 'En kompis');
$function$;
