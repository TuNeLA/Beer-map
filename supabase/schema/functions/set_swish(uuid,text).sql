-- public.set_swish(p_group_id uuid, p_number text)
-- live md5(pg_get_functiondef) = c524d0daf62de0042ecf63f19639b93d
CREATE OR REPLACE FUNCTION public.set_swish(p_group_id uuid, p_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v text := regexp_replace(coalesce(p_number, ''), '[\s\-().]', '', 'g');
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v like '+46%' then v := '0' || substr(v, 4); elsif v like '0046%' then v := '0' || substr(v, 5); end if;
  if v = '' then v := null;
  elsif v !~ '^07[0-9]{8}$' then raise exception 'invalid_swish';
  end if;
  if (select s.changes from public.gang_swish s where s.group_id = p_group_id and s.user_id = v_uid) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.gang_swish (group_id, user_id, number, changes) values (p_group_id, v_uid, v, 1)
  on conflict (group_id, user_id) do update set number = excluded.number, changes = public.gang_swish.changes + 1, updated_at = now();
  return jsonb_build_object('number', v);
end; $function$;
