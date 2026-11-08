-- public.olnu_inv_key(p_viewer uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 21732f89c2f1a76e8b6ffe7c268f402f
CREATE OR REPLACE FUNCTION public.olnu_inv_key(p_viewer uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_viewer::text || ':' || p_uid::text || ':olnu-inv'), 1, 16);
$function$;
