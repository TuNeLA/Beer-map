-- public.olnu_rnd_member(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = b4b09ac6490aaec04612831d22dfde5b
CREATE OR REPLACE FUNCTION public.olnu_rnd_member(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
      or public.olnu_evg_member(p_group, p_uid);
$function$;
