-- public.olnu_name_for(p_viewer uuid, p_user uuid)
-- live md5(pg_get_functiondef) = 018a60ec24fddb12542341510104af29
CREATE OR REPLACE FUNCTION public.olnu_name_for(p_viewer uuid, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p_viewer = p_user
    then (select min(m.display_name) from public.group_members m where m.user_id = p_user)
    else (select min(t.display_name) from public.group_members t
            join public.group_members v on v.group_id = t.group_id and v.user_id = p_viewer
           where t.user_id = p_user) end;
$function$;
