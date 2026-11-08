-- public.olnu_gang_uid_of(p_group uuid, p_k text)
-- live md5(pg_get_functiondef) = 25c0002cda75db26a933e21113d3e8a1
CREATE OR REPLACE FUNCTION public.olnu_gang_uid_of(p_group uuid, p_k text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id from public.group_members m
   where m.group_id = p_group and public.olnu_gang_k(p_group, m.user_id) = p_k limit 1;
$function$;
