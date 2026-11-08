-- public.olnu_wd_clean(p text)
-- live md5(pg_get_functiondef) = 214aadbec3ae88ced526dfd058938e6d
CREATE OR REPLACE FUNCTION public.olnu_wd_clean(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
$function$;
