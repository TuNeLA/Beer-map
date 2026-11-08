-- public.olnu_eta_clean(p text, n integer)
-- live md5(pg_get_functiondef) = 27be4df9c4ef5925b7cbae7a889fae99
CREATE OR REPLACE FUNCTION public.olnu_eta_clean(p text, n integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$function$;
