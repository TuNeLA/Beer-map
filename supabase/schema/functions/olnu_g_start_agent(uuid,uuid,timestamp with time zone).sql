-- public.olnu_g_start_agent(p_uid uuid, p_group uuid, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = fd9d1a3ebb0931276a7923d016d05c04
CREATE OR REPLACE FUNCTION public.olnu_g_start_agent(p_uid uuid, p_group uuid, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_a     record;
  v_agent uuid;
  v_out   int;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_night;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'is_me', v_a.agent = p_uid);
  end if;
  if (select count(*) from public.group_members m where m.group_id = p_group) < 3 then
    raise exception 'not_enough';
  end if;
  select count(*) into v_out from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night);
  if v_out < 2 then
    raise exception 'not_enough';
  end if;
  select m.user_id into v_agent from public.group_members m
   where m.group_id = p_group and public.olnu_g_outtonight(m.user_id, v_night)
   order by random() limit 1;
  insert into public.game_agents (group_id, night, agent, mission, started_by, created_at)
  values (p_group, v_night, v_agent, floor(random() * 1000)::int, p_uid, p_now)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'already', false, 'is_me', v_agent = p_uid);
end;
$function$;
