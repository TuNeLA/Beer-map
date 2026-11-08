-- public.olnu_ho_hash(p_id text)
-- live md5(pg_get_functiondef) = bd7ddd74117b62c8d4ada685bbca27b9
CREATE OR REPLACE FUNCTION public.olnu_ho_hash(p_id text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  select encode(extensions.digest(p_id, 'sha256'), 'hex');
$function$;
