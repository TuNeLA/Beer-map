-- public.olnu_party_norm(p text)
-- live md5(pg_get_functiondef) = db914a511e58964bee5bea1121aaf436
CREATE OR REPLACE FUNCTION public.olnu_party_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9åäöéèüæøß]', '', 'g');
$function$;
