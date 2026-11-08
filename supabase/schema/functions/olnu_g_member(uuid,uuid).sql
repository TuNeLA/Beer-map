-- public.olnu_g_member(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 8bff8cc74805a47a8fd60fd2fb3dee6e
CREATE OR REPLACE FUNCTION public.olnu_g_member(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
      or public.olnu_evg_member(p_group, p_uid);
$function$;
