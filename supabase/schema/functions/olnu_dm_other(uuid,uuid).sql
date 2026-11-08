-- public.olnu_dm_other(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = ded24f92503ffa020d0992fe1bebce12
CREATE OR REPLACE FUNCTION public.olnu_dm_other(p_gid uuid, p_uid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when t.a = p_uid then t.b when t.b = p_uid then t.a end
    from public.dm_threads t where t.group_id = p_gid;
$function$;
