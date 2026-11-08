-- public.olnu_gh_name(p_user uuid, p_viewer uuid)
-- live md5(pg_get_functiondef) = cd2b48b9c3e0c66803d003d06414ff2f
CREATE OR REPLACE FUNCTION public.olnu_gh_name(p_user uuid, p_viewer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p_user = p_viewer then (select min(m.display_name) from public.group_members m where m.user_id = p_user)
    else (select min(m.display_name) from public.group_members m join public.group_members v on v.group_id = m.group_id
           where m.user_id = p_user and v.user_id = p_viewer) end;
$function$;
