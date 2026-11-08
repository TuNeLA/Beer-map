-- public.olnu_sug_k(p_viewer uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 8d8bd3611f60d7e0a040491d35936685
CREATE OR REPLACE FUNCTION public.olnu_sug_k(p_viewer uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select left(md5(p_viewer::text || ':' || p_uid::text || ':olnu-sug'), 16); $function$;
