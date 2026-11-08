-- public.account_config()
-- live md5(pg_get_functiondef) = db1af7d4d83b4dc01a06b5cf4eaee97b
CREATE OR REPLACE FUNCTION public.account_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'v', 1,
    'email', coalesce((select f.enabled from public.app_account_flags f where f.key = 'email_login'), false),
    'google', coalesce((select f.enabled from public.app_account_flags f where f.key = 'google_login'), false)
  );
$function$;
