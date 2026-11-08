-- public.olnu_find_name(r find_reqs, p_viewer uuid)
-- live md5(pg_get_functiondef) = a7f55a6eb6f41ab4a6c7e7e660437fc4
CREATE OR REPLACE FUNCTION public.olnu_find_name(r find_reqs, p_viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when r.group_id is not null
              then (select gm.display_name from public.group_members gm where gm.group_id = r.group_id
                       and gm.user_id = case when r.from_uid = p_viewer then r.to_uid else r.from_uid end)
              else public.olnu_friend_name(case when r.from_uid = p_viewer then r.to_uid else r.from_uid end) end;
$function$;
