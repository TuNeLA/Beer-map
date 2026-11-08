-- public.olnu_rnd_name(p_group uuid, p_uid uuid)
-- live md5(pg_get_functiondef) = 18edad1f5cc0ca9cf9bb10e5be23ed0e
CREATE OR REPLACE FUNCTION public.olnu_rnd_name(p_group uuid, p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select m.display_name from public.group_members m where m.group_id = p_group and m.user_id = p_uid),
                  (select e.name from public.olnu_evg_people(p_group) e where e.user_id = p_uid limit 1), '?');
$function$;
