-- public.olnu_chief_of(p_group uuid)
-- live md5(pg_get_functiondef) = 38610b4b221c84911411c93cc5063274
CREATE OR REPLACE FUNCTION public.olnu_chief_of(p_group uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select c.user_id from public.group_chiefs c
       join public.group_members m on m.group_id = c.group_id and m.user_id = c.user_id
      where c.group_id = p_group),
    (select g.created_by from public.groups g
       join public.group_members m on m.group_id = g.id and m.user_id = g.created_by
      where g.id = p_group),
    (select m.user_id from public.group_members m where m.group_id = p_group order by m.joined_at, m.user_id limit 1));
$function$;
