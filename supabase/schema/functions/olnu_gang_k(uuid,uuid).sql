-- public.olnu_gang_k(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = b79d1bf966c36c1c2293153ebc989897
CREATE OR REPLACE FUNCTION public.olnu_gang_k(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_group::text || ':' || p_uid::text || ':olnu-gang'), 1, 12);
$function$;
