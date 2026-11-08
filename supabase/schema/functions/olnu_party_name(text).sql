-- public.olnu_party_name(p text)
-- live md5(pg_get_functiondef) = 4e008d6786451f6ed76e2a2db8fe7cde
CREATE OR REPLACE FUNCTION public.olnu_party_name(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\u0000-\u001f<>]', '', 'g'), '\s+', ' ', 'g')), 20), '');
$function$;
