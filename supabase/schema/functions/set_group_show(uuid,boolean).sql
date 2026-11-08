-- public.set_group_show(p_group_id uuid, p_on boolean)
-- live md5(pg_get_functiondef) = ef11fe7521663a49467005ce8737c040
CREATE OR REPLACE FUNCTION public.set_group_show(p_group_id uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
begin
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if not public.olnu_group_admin(p_group_id, v_uid) then raise exception 'not_admin'; end if;
  insert into public.group_flags as f (group_id, show_on_map, updated_at, updated_by)
  values (p_group_id, coalesce(p_on, false), now(), v_uid)
  on conflict (group_id) do update set show_on_map = excluded.show_on_map, updated_at = now(), updated_by = v_uid;
  return jsonb_build_object('show_on_map', coalesce(p_on, false));
end;
$function$;
