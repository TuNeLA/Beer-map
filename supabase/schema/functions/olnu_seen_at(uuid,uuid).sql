-- public.olnu_seen_at(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 9eddc0a58d6dac26787d01fc3c86bcce
CREATE OR REPLACE FUNCTION public.olnu_seen_at(p_group uuid, p_uid uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select greatest(
    (select s.seen_at from public.user_seen s where s.user_id = p_uid),
    (select b.updated_at from public.beers b where b.user_id = p_uid),
    (select max(gm.created_at) from public.group_msgs gm where gm.user_id = p_uid and gm.created_at > now() - interval '13 hours'),
    (select m.joined_at from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
    (select c.updated_at from public.group_chiefs c where c.group_id = p_group and c.user_id = p_uid));
$function$;
