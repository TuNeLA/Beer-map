-- public.olnu_crew_member(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = e3963c5cc7ff0c08bd8d39cba246cbe8
CREATE OR REPLACE FUNCTION public.olnu_crew_member(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$function$;
