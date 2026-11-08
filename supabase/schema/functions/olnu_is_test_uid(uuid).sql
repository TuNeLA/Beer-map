-- public.olnu_is_test_uid(p_uid uuid)
-- live md5(pg_get_functiondef) = 595f00eaf1eb4236abac732ca2f7df4f
CREATE OR REPLACE FUNCTION public.olnu_is_test_uid(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and (
    exists (select 1 from auth.users u where u.id = p_uid and coalesce(u.raw_user_meta_data ->> 'test', '') in ('true', '1'))
    or exists (select 1 from public.olnu_test_users t where t.user_id = p_uid)
    or public.olnu_is_test_user(p_uid));
$function$;
