-- public.olnu_crew_glabel(p_group uuid, p_viewer uuid)
-- live md5(pg_get_functiondef) = 2959307f2b887c99e190d351c617865e
CREATE OR REPLACE FUNCTION public.olnu_crew_glabel(p_group uuid, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p_group is null then null else jsonb_build_object(
    'name', case when public.olnu_crew_member(p_group, p_viewer)
                   or coalesce((select f.show_on_map from public.group_flags f where f.group_id = p_group), false)
                 then (select g.name from public.groups g where g.id = p_group) end,
    'mine', public.olnu_crew_member(p_group, p_viewer)) end;
$function$;
