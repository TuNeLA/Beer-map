-- public.olnu_avatar_seed(p_uid uuid)
-- live md5(pg_get_functiondef) = 3d22d36f54c40e94943f9939f54c141e
CREATE OR REPLACE FUNCTION public.olnu_avatar_seed(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_uid::text || ':olnu-avatar'), 1, 8);
$function$;
