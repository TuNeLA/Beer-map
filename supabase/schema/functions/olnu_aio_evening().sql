-- public.olnu_aio_evening()
-- live md5(pg_get_functiondef) = 2b8b1d2d0b733aa1ae411b06d9999b5e
CREATE OR REPLACE FUNCTION public.olnu_aio_evening()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.olnu_evening(public.olnu_night_of(now()));
$function$;
