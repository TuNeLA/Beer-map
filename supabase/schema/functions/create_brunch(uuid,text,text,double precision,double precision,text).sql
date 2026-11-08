-- public.create_brunch(p_group_id uuid, p_place text, p_place_id text, p_lat double precision, p_lng double precision, p_at text)
-- live md5(pg_get_functiondef) = ba2676f7bfcda19ecf3ff07c0224c8b1
CREATE OR REPLACE FUNCTION public.create_brunch(p_group_id uuid, p_place text, p_place_id text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_at text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_place text := public.olnu_gang_clean(p_place);
  v_pid text := nullif(public.olnu_gang_clean(p_place_id), '');
  v_at text := nullif(public.olnu_gang_clean(p_at), '');
  v_h int := public.olnu_gang_hour();
  v_lat float8; v_lng float8;
  v_id bigint;
begin
  if not public.olnu_gang_member(p_group_id, v_uid) then raise exception 'not_member'; end if;
  if v_h < 6 or v_h >= 14 then raise exception 'not_morning'; end if;
  if v_place = '' or char_length(v_place) > 60 or (v_pid is not null and char_length(v_pid) > 80)
     or (v_at is not null and v_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'invalid_brunch';
  end if;
  if public.olnu_world_ok(p_lat, p_lng) then v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8; end if;
  perform public.olnu_gang_rl('brunch:' || p_group_id::text);
  if exists (select 1 from public.gang_brunches b where b.user_id = v_uid and b.created_at > now() - interval '2 minutes') then
    raise exception 'slow_down';
  end if;
  if exists (select 1 from public.gang_brunches b where b.group_id = p_group_id and not b.closed and b.expires_at > now() and b.user_id <> v_uid) then
    raise exception 'brunch_open';
  end if;
  update public.gang_brunches b set closed = true where b.group_id = p_group_id and b.user_id = v_uid and not b.closed;
  insert into public.gang_brunches (group_id, user_id, place, place_id, lat, lng, at_time, expires_at)
  values (p_group_id, v_uid, v_place, v_pid, v_lat, v_lng, v_at,
          greatest((((now() at time zone 'Europe/Stockholm')::date + time '16:00') at time zone 'Europe/Stockholm'),
                   now() + interval '2 hours'))
  returning id into v_id;
  insert into public.gang_brunch_answers (brunch_id, user_id, answer) values (v_id, v_uid, 'ja');
  return jsonb_build_object('id', v_id);
end; $function$;
