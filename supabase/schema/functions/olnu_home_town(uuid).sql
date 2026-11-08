-- public.olnu_home_town(p_uid uuid)
-- live md5(pg_get_functiondef) = 22d30327b611032475d5606d57bb1a4a
CREATE OR REPLACE FUNCTION public.olnu_home_town(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select h.town from public.user_home h where h.user_id = p_uid;
$function$;
