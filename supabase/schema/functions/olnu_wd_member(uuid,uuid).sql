-- public.olnu_wd_member(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = a60a7178122858703780d2b8fc7d7d76
CREATE OR REPLACE FUNCTION public.olnu_wd_member(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$function$;
