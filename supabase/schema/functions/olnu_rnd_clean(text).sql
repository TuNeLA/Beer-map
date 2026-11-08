-- public.olnu_rnd_clean(p text)
-- live md5(pg_get_functiondef) = fdce4fd63c45e8b00224da21244d0816
CREATE OR REPLACE FUNCTION public.olnu_rnd_clean(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$function$;
