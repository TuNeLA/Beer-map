-- public.olnu_is_vice(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 0b345c1aa160b064280100fa0aa67087
CREATE OR REPLACE FUNCTION public.olnu_is_vice(p_group uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.group_vices v
      join public.group_members m on m.group_id = v.group_id and m.user_id = v.user_id and m.joined_at = v.member_since
     where v.group_id = p_group and v.user_id = p_uid and v.active);
$function$;
