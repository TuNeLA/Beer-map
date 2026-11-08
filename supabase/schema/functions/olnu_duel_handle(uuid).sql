-- public.olnu_duel_handle(p_group uuid)
-- live md5(pg_get_functiondef) = 055d61af96cc43421c3b9d0d1cd93ce7
CREATE OR REPLACE FUNCTION public.olnu_duel_handle(p_group uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select substr(md5(p_group::text || ':' || public.olnu_night_of(now())::text || ':olnu-duel'), 1, 12);
$function$;
