-- public.public_config()
-- live md5(pg_get_functiondef) = 11cd124d8af2a7afa474b19af8d54d99
CREATE OR REPLACE FUNCTION public.public_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'v', 3,
    'mapbox_token', (select c.value from public.app_public_config c where c.key = 'mapbox_token' and c.value like 'pk.%'),
    'visning', coalesce((select f.value from public.app_public_flags f where f.key = 'visning'), 'off'),
    'store_mode', coalesce((select f.value from public.app_store_flags f where f.key = 'store_mode'), 'off'),
    'support', 'support@pintsnow.com',
    'terms_ver', 1
  );
$function$;
