-- public.crew_dep_set(p_group_id uuid, p_leave_at timestamp with time zone, p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = a3341d6d6c4b65c6d4fe2de6c36dca2c
CREATE OR REPLACE FUNCTION public.crew_dep_set(p_group_id uuid, p_leave_at timestamp with time zone, p_bar_id text DEFAULT NULL::text, p_bar_name text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_night timestamptz := public.olnu_night_of(now());
  v_bar text := public.olnu_crew_clean(p_bar_id, 200);
  v_name text := public.olnu_crew_clean(p_bar_name, 200);
  v_lat float8; v_lng float8; v_id bigint;
begin
  if not public.olnu_crew_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_leave_at is null or p_leave_at < now() - interval '1 minute' or p_leave_at > now() + interval '12 hours' then
    raise exception 'invalid_time';
  end if;
  if (v_bar is not null and char_length(v_bar) > 80) or (v_name is not null and char_length(v_name) > 60) then
    raise exception 'invalid_bar';
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dep:' || p_group_id::text, 0));
  if exists (select 1 from public.crew_deps d where d.user_id = v_uid and d.created_at > now() - interval '30 seconds') then
    raise exception 'slow_down';
  end if;
  update public.crew_deps d set cancelled_at = now()
   where d.group_id = p_group_id and d.user_id = v_uid and d.night = v_night and d.cancelled_at is null;
  if (select count(*) from public.crew_deps d where d.group_id = p_group_id and d.night = v_night
         and d.cancelled_at is null and d.leave_at > now() - interval '15 minutes') >= 4 then
    raise exception 'board_full';
  end if;
  insert into public.crew_deps (group_id, user_id, night, leave_at, bar_id, bar_name, lat, lng)
  values (p_group_id, v_uid, v_night, date_trunc('minute', p_leave_at), v_bar, v_name, v_lat, v_lng)
  returning id into v_id;
  insert into public.crew_dep_going (dep_id, user_id, going) values (v_id, v_uid, true)
  on conflict (dep_id, user_id) do update set going = true, updated_at = now();
  return jsonb_build_object('id', v_id, 'leave_at', date_trunc('minute', p_leave_at));
end; $function$;
