-- public.olnu_chief_from()
-- live md5(pg_get_functiondef) = a4cd352a51af780462d034b5d2be8f39
CREATE OR REPLACE FUNCTION public.olnu_chief_from()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select ((public.olnu_next_expiry() at time zone 'Europe/Stockholm') - interval '1 day') at time zone 'Europe/Stockholm';
$function$;
