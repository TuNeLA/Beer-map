-- public.crew_mood_start(p_group_id uuid)
-- live md5(pg_get_functiondef) = 71a9ed3fb42aa691f73a77bc62fb796d
CREATE OR REPLACE FUNCTION public.crew_mood_start(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_mood:' || p_group_id::text, 0));
  select x.id into v_id from public.crew_moods x where x.group_id = p_group_id and x.ends_at > now() order by x.id desc limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'already', true); end if;
  if exists (select 1 from public.crew_moods x where x.user_id = v_uid and x.created_at > now() - interval '10 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.crew_moods (group_id, user_id, night, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), now() + interval '40 minutes') returning id into v_id;
  return jsonb_build_object('id', v_id, 'already', false);
end; $function$;
