-- public.create_bar_poll(p_group_id uuid, p_options jsonb)
-- live md5(pg_get_functiondef) = f82671fcdaa2e1a28666ab922ec87e91
CREATE OR REPLACE FUNCTION public.create_bar_poll(p_group_id uuid, p_options jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_opts jsonb := '[]'::jsonb;
  o jsonb;
  v_id text; v_name text; v_lat float8; v_lng float8;
  p public.gang_polls;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 4 then
    raise exception 'invalid_poll';
  end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) <> 'object' then raise exception 'invalid_poll'; end if;
    v_id := public.olnu_gang_clean(o ->> 'id');
    v_name := public.olnu_gang_clean(o ->> 'name');
    begin
      v_lat := (o ->> 'lat')::float8; v_lng := (o ->> 'lng')::float8;
    exception when others then raise exception 'invalid_poll';
    end;
    if v_id = '' or char_length(v_id) > 80 or v_name = '' or char_length(v_name) > 60 or not public.olnu_world_ok(v_lat, v_lng) then
      raise exception 'invalid_poll';
    end if;
    if exists (select 1 from jsonb_array_elements(v_opts) e where e.value ->> 'id' = v_id) then raise exception 'invalid_poll'; end if;
    v_opts := v_opts || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name,
                'lat', round(v_lat::numeric, 5)::float8, 'lng', round(v_lng::numeric, 5)::float8));
  end loop;
  perform public.olnu_gang_rl('poll:' || p_group_id::text);
  for p in select * from public.gang_polls x where x.group_id = p_group_id and x.ended_at is null loop
    if p.ends_at > now() then raise exception 'poll_open'; end if;
    perform public.olnu_gang_poll_finish(p.id, v_uid);
  end loop;
  if exists (select 1 from public.gang_polls x where x.user_id = v_uid and x.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.gang_polls (group_id, user_id, night, options, ends_at)
  values (p_group_id, v_uid, public.olnu_night_of(now()), v_opts, now() + interval '15 minutes')
  returning * into p;
  return jsonb_build_object('id', p.id, 'ends_at', p.ends_at);
end; $function$;
