-- public.olnu_chat_can(p_gid uuid, p_uid uuid, p_write boolean)
-- live md5(pg_get_functiondef) = 3ec93d1b88954c1e0744fca7dd02e97d
CREATE OR REPLACE FUNCTION public.olnu_chat_can(p_gid uuid, p_uid uuid, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_uid is not null and (
    exists (select 1 from public.group_members m where m.group_id = p_gid and m.user_id = p_uid)
    or coalesce(public.olnu_tg_access(p_gid, p_uid), 'none') = any (case when p_write then array['write'] else array['read', 'write'] end)
    or coalesce(public.olnu_dm_access(p_gid, p_uid), 'none') = any (case when p_write then array['write'] else array['read', 'write'] end));
$function$;
