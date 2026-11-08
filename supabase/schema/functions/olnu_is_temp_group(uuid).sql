-- public.olnu_is_temp_group(p_gid uuid)
-- live md5(pg_get_functiondef) = 5e6a286786d6efddb1f7581f235a004b
CREATE OR REPLACE FUNCTION public.olnu_is_temp_group(p_gid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.temp_groups t where t.group_id = p_gid)
      or exists (select 1 from public.dm_threads d where d.group_id = p_gid);
$function$;
