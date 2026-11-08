-- public.olnu_gang_hour()
-- live md5(pg_get_functiondef) = 6b430197a26810062e0afaef85a87207
CREATE OR REPLACE FUNCTION public.olnu_gang_hour()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select extract(hour from (now() at time zone 'Europe/Stockholm'))::int;
$function$;
