-- public.olnu_crew_clean(p text, n integer)
-- live md5(pg_get_functiondef) = 4b74aa3a8bb5b22b4109ef76e4c193f0
CREATE OR REPLACE FUNCTION public.olnu_crew_clean(p text, n integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), n), '');
$function$;
