-- public.olnu_group_admin(p_group_id uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = d43ffd328da691d5c4b620fd7339b0b1
CREATE OR REPLACE FUNCTION public.olnu_group_admin(p_group_id uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_uid)
     and (
       exists (select 1 from public.groups g where g.id = p_group_id and g.created_by = p_uid)
       or (
         not exists (select 1 from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
                      where g.id = p_group_id)
         and p_uid = (select m.user_id from public.group_members m where m.group_id = p_group_id
                       order by m.joined_at, m.user_id limit 1)
       )
     );
$function$;
