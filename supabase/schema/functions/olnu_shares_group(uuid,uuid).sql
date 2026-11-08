-- public.olnu_shares_group(p_a uuid, p_b uuid)
-- live md5(pg_get_functiondef) = 5091ee05ee8d342400fd7df8620b6b45
CREATE OR REPLACE FUNCTION public.olnu_shares_group(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members a
                   join public.group_members b on b.group_id = a.group_id and b.user_id = p_b
                  where a.user_id = p_a);
$function$;
