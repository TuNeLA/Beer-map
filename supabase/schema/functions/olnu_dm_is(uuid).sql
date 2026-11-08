-- public.olnu_dm_is(p_gid uuid)
-- live md5(pg_get_functiondef) = 9509db48262b746643295bae9be0fdc1
CREATE OR REPLACE FUNCTION public.olnu_dm_is(p_gid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.dm_threads t where t.group_id = p_gid);
$function$;
