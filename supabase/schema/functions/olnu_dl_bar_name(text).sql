-- public.olnu_dl_bar_name(p_id text)
-- live md5(pg_get_functiondef) = 034d855faf3062f09eeaa2fc29f99eb5
CREATE OR REPLACE FUNCTION public.olnu_dl_bar_name(p_id text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select left(b.name, 60) from public.bars_lite b where b.id = p_id limit 1;
$function$;
