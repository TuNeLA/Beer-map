-- public.dm_seen(p_group_id uuid, p_last_id bigint)
-- live md5(pg_get_functiondef) = 99be12a6a899c2ecff6d609ee6ecd014
CREATE OR REPLACE FUNCTION public.dm_seen(p_group_id uuid, p_last_id bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_max bigint;
begin
  if public.olnu_dm_other(p_group_id, v_uid) is null then raise exception 'not_member'; end if;
  if coalesce(p_last_id, 0) > 0 then
    select max(m.id) into v_max from public.group_msgs m where m.group_id = p_group_id and m.id <= p_last_id;
    if v_max is not null then
      insert into public.dm_state as s (group_id, user_id, seen_id, seen_at) values (p_group_id, v_uid, v_max, now())
      on conflict (group_id, user_id) do update set seen_id = v_max, seen_at = now(), updated_at = now()
       where s.seen_id < v_max;
    end if;
  end if;
  return public.olnu_dm_json(p_group_id, v_uid);
end; $function$;
