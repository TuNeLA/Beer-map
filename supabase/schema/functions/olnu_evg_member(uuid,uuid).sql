-- public.olnu_evg_member(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 7a40cd19ce8f63c1071fb0bff71bef6b
CREATE OR REPLACE FUNCTION public.olnu_evg_member(p_gid uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and exists (select 1 from public.temp_groups t where t.group_id = p_gid)
     and coalesce(public.olnu_tg_access(p_gid, p_uid), 'none') = 'write';
$function$;
