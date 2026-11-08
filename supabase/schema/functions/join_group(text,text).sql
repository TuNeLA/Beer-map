-- public.join_group(p_code text, p_display_name text)
-- live md5(pg_get_functiondef) = 908cd2b8b9e11e97dd681da938b087f5
CREATE OR REPLACE FUNCTION public.join_group(p_code text, p_display_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := public.olnu_uid();
  v_code    text := upper(btrim(coalesce(p_code, '')));
  v_display text := public.olnu_clean_display_name(p_display_name);
  v_group   public.groups%rowtype;
begin
  if (select count(*) from public.join_fails f where f.user_id = v_uid and f.at > now() - interval '10 minutes') >= 8 then
    raise exception 'slow_down';
  end if;
  select * into v_group from public.groups g where g.code = v_code;
  if not found then
    insert into public.join_fails (user_id) values (v_uid);
    perform set_config('response.status', '400', true);
    return json_build_object('code', 'P0001', 'message', 'group_not_found', 'details', null, 'hint', null);
  end if;
  insert into public.group_members (group_id, user_id, display_name)
  values (v_group.id, v_uid, v_display)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', v_group.id, 'name', v_group.name, 'code', v_group.code);
end;
$function$;
