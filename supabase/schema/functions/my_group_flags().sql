-- public.my_group_flags()
-- live md5(pg_get_functiondef) = c3b541ca7ad9b503ad4d8f8d34b2b5b4
CREATE OR REPLACE FUNCTION public.my_group_flags()
 RETURNS TABLE(group_id uuid, show_on_map boolean, can_edit boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  return query
  select m.group_id, coalesce(f.show_on_map, false), public.olnu_group_admin(m.group_id, v_uid)
    from public.group_members m
    left join public.group_flags f on f.group_id = m.group_id
   where m.user_id = v_uid
   order by m.joined_at;
end;
$function$;
