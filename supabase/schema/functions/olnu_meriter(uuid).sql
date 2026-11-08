-- public.olnu_meriter(p_uid uuid)
-- live md5(pg_get_functiondef) = 591ebda64fb92ee68060b6a60e760974
CREATE OR REPLACE FUNCTION public.olnu_meriter(p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select t.total from public.meriter_totals t where t.user_id = p_uid), 0)::int;
$function$;
