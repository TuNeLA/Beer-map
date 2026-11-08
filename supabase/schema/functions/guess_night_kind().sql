-- public.guess_night_kind()
-- live md5(pg_get_functiondef) = 88b74ba5b6d31c9a64a8a6869e1aedcb
CREATE OR REPLACE FUNCTION public.guess_night_kind()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ select 'folk'::text; $function$;
