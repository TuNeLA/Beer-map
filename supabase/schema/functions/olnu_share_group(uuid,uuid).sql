-- public.olnu_share_group(p_x uuid, p_y uuid)
-- live md5(pg_get_functiondef) = adfeb22a1bca931abd2cf5272cfaff04
CREATE OR REPLACE FUNCTION public.olnu_share_group(p_x uuid, p_y uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
                  where a.user_id = p_x and b.user_id = p_y);
$function$;
