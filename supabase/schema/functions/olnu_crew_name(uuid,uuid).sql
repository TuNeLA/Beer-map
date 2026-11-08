-- public.olnu_crew_name(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 5c0ac942c33b2813e56c85b96de6a3f6
CREATE OR REPLACE FUNCTION public.olnu_crew_name(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$function$;
