-- public.olnu_inv_clean(p text, p_max integer)
-- live md5(pg_get_functiondef) = 7047c3851ee7e8c6c99f649c49694b71
CREATE OR REPLACE FUNCTION public.olnu_inv_clean(p text, p_max integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]+', ' ', 'g')), p_max), '');
$function$;
