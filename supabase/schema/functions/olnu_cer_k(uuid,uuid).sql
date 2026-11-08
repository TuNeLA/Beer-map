-- public.olnu_cer_k(p_gid uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 7f1d6d0c93eb30ba0c59bf22b5527393
CREATE OR REPLACE FUNCTION public.olnu_cer_k(p_gid uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_gid::text || ':' || p_uid::text || ':olnu-cer'), 1, 12);
$function$;
