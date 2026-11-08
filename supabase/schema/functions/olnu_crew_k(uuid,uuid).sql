-- public.olnu_crew_k(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = b57987ebe5098dd7773971f8648ab4df
CREATE OR REPLACE FUNCTION public.olnu_crew_k(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select left(md5('crew:' || p_group::text || ':' || p_uid::text), 12);
$function$;
