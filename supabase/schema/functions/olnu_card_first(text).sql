-- public.olnu_card_first(p text)
-- live md5(pg_get_functiondef) = b18d37a0b822bed9e910f129747f37af
CREATE OR REPLACE FUNCTION public.olnu_card_first(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(split_part(btrim(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g')), ' ', 1), 20), '');
$function$;
