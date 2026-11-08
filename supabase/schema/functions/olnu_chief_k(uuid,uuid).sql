-- public.olnu_chief_k(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = f46925dfbad12ba02d0fbb2d98e7a02d
CREATE OR REPLACE FUNCTION public.olnu_chief_k(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-chief'), 1, 12);
$function$;
