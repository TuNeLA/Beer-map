-- public.olnu_gang_name(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = a60dfb344c04cfe8103c0ca111944215
CREATE OR REPLACE FUNCTION public.olnu_gang_name(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid;
$function$;
