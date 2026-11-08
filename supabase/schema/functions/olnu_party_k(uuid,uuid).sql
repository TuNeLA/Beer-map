-- public.olnu_party_k(p_room uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 6521b09f2c40409bdeee82e818a2198d
CREATE OR REPLACE FUNCTION public.olnu_party_k(p_room uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5('olnu-party:' || p_room::text || ':' || p_uid::text), 1, 12);
$function$;
