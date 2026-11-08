-- public.olnu_g_vote(p_uid uuid, p_group uuid, p_member text, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 0af77cbfc90c2bfbb4c32339a33f84f4
CREATE OR REPLACE FUNCTION public.olnu_g_vote(p_uid uuid, p_group uuid, p_member text, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev timestamptz := public.olnu_g_prev(public.olnu_night_of(p_now));
  v_a    record;
  v_s    uuid;
  v_new  boolean;
begin
  if not public.olnu_g_member(p_group, p_uid) then
    raise exception 'not_member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_agent:' || p_group::text, 0));
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  select * into v_a from public.game_agents a where a.group_id = p_group and a.night = v_prev;
  if not found or v_a.revealed_at is not null then
    raise exception 'no_agent';
  end if;
  if v_a.agent = p_uid then
    raise exception 'is_agent';
  end if;
  select m.user_id into v_s from public.group_members m
   where m.group_id = p_group and public.olnu_g_key(p_group, m.user_id) = btrim(coalesce(p_member, ''));
  if v_s is null or v_s = p_uid then
    raise exception 'invalid_suspect';
  end if;
  insert into public.game_agent_votes (group_id, night, voter, suspect, created_at)
  values (p_group, v_prev, p_uid, v_s, p_now)
  on conflict do nothing;
  v_new := found;
  perform public.olnu_g_reveal(p_group, v_prev, p_now);
  return jsonb_build_object('ok', true, 'already', not v_new,
    'revealed', exists (select 1 from public.game_agents a where a.group_id = p_group and a.night = v_prev and a.revealed_at is not null));
end;
$function$;
