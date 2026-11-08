-- public.olnu_skal_can(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 391683b73ff6786814429ad5f0dfb908
CREATE OR REPLACE FUNCTION public.olnu_skal_can(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null
     and exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p_uid)
     and (public.olnu_chief_of(p_group) = p_uid
          or public.olnu_owner_of(p_group) is not distinct from p_uid
          or public.olnu_is_vice(p_group, p_uid));
$function$;
