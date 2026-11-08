-- public.olnu_rnd_k(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 1775990414adbcaca7932e960faf091a
CREATE OR REPLACE FUNCTION public.olnu_rnd_k(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-rnd'), 1, 12);
$function$;
