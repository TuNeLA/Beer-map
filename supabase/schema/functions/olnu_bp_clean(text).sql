-- public.olnu_bp_clean(p text)
-- live md5(pg_get_functiondef) = 97a0a5099cabe4d7f7e4fee8a4b00633
CREATE OR REPLACE FUNCTION public.olnu_bp_clean(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$function$;
