-- public.olnu_spel_k(p_room uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 4e8c311eec743df35b5cdff53b52c58f
CREATE OR REPLACE FUNCTION public.olnu_spel_k(p_room uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5('olnu-spel:' || p_room::text || ':' || p_uid::text), 1, 12);
$function$;
