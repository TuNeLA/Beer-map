-- public.olnu_lifetime(p_uid uuid)
-- live md5(pg_get_functiondef) = 979969166ec24bb13218c09a887cb5b9
CREATE OR REPLACE FUNCTION public.olnu_lifetime(p_uid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(w.n), 0)::int from public.week_beers w where w.user_id = p_uid;
$function$;
