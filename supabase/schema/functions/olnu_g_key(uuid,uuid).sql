-- public.olnu_g_key(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 8afbe76be4c955f55df892bc4648cefb
CREATE OR REPLACE FUNCTION public.olnu_g_key(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-game'), 1, 12);
$function$;
