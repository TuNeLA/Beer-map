-- public.olnu_party_text(p text, p_max integer)
-- live md5(pg_get_functiondef) = 5f88dd55607c9d706cbcb00274725436
CREATE OR REPLACE FUNCTION public.olnu_party_text(p text, p_max integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[\u0000-\u001f<>]', '', 'g'), '\s+', ' ', 'g')), p_max), '');
$function$;
