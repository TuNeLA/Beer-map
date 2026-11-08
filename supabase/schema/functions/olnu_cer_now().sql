-- public.olnu_cer_now()
-- live md5(pg_get_functiondef) = 4f7f303a945936fe2f067443fccd8b32
CREATE OR REPLACE FUNCTION public.olnu_cer_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(nullif(current_setting('olnu.cer_now', true), '')::timestamptz, now());
$function$;
