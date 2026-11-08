-- public.olnu_store_on()
-- live md5(pg_get_functiondef) = d2d2ec93b5ce4badaeed67aa55881869
CREATE OR REPLACE FUNCTION public.olnu_store_on()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select f.value = 'on' from public.app_store_flags f where f.key = 'store_mode'), false)
      or coalesce(current_setting('olnu.store_test', true), '') = '1';
$function$;
