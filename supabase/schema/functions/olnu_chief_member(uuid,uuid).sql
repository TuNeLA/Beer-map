-- public.olnu_chief_member(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = b22be8ab1859a76e52e990622e023fee
CREATE OR REPLACE FUNCTION public.olnu_chief_member(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid);
$function$;
