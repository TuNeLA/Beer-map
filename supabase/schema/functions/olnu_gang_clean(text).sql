-- public.olnu_gang_clean(p text)
-- live md5(pg_get_functiondef) = 8c151dabac2fe814f885cfb63fc1e76a
CREATE OR REPLACE FUNCTION public.olnu_gang_clean(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$function$;
