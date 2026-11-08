-- public.olnu_place_slug(p text)
-- live md5(pg_get_functiondef) = 018e03e816190424caa9db74d962d6b7
CREATE OR REPLACE FUNCTION public.olnu_place_slug(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(
           translate(lower(coalesce(p, '')), 'åäöéèüæøáàíóú', 'aaoeeuaoaaiou'), '[^a-z0-9]+', '-', 'g')), 30), ''), 'stalle');
$function$;
