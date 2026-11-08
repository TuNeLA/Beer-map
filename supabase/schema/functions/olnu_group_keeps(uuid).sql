-- public.olnu_group_keeps(p_group_id uuid)
-- live md5(pg_get_functiondef) = cb1131bbd33329beea6372ce048913e4
CREATE OR REPLACE FUNCTION public.olnu_group_keeps(p_group_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select s.keep_history from public.group_settings s where s.group_id = p_group_id), false);
$function$;
