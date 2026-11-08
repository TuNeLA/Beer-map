-- public.set_eta(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision, p_minutes integer, p_rally_id bigint)
-- live md5(pg_get_functiondef) = 4d634914c2f0db1687075663fbe28a45
CREATE OR REPLACE FUNCTION public.set_eta(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision, p_minutes integer, p_rally_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := public.olnu_uid();
  v_bar   text := public.olnu_eta_clean(p_bar_id, 200);
  v_name  text := public.olnu_eta_clean(p_bar_name, 200);
  v_lat   float8; v_lng float8; v_group uuid := null;
  r       public.rallies;
  v_last  timestamptz;
  e       public.etas;
begin
  if p_minutes is null or p_minutes not in (5, 10, 15, 20, 30) then raise exception 'invalid_minutes'; end if;
  if p_rally_id is not null then
    select * into r from public.rallies x where x.id = p_rally_id and not x.closed and x.expires_at > now();
    if not found then raise exception 'rally_not_found'; end if;
    if not exists (select 1 from public.group_members m where m.group_id = r.group_id and m.user_id = v_uid) then
      raise exception 'not_member';
    end if;
    v_group := r.group_id;
    if v_bar is not null and char_length(v_bar) > 80 then v_bar := null; end if;
    v_name := left(coalesce(v_name, public.olnu_eta_clean(r.place, 60)), 60);
    if public.olnu_world_ok(p_lat, p_lng) then
      v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
    elsif r.lat is not null and r.lng is not null then
      v_lat := r.lat; v_lng := r.lng;
    end if;
  else
    if v_bar is null or char_length(v_bar) > 80 or v_name is null or char_length(v_name) > 60 then
      raise exception 'invalid_bar';
    end if;
    if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
    v_lat := round(p_lat::numeric, 5)::float8; v_lng := round(p_lng::numeric, 5)::float8;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_eta:' || v_uid::text, 0));
  select max(x.created_at) into v_last from public.etas x where x.user_id = v_uid;
  if v_last is not null and v_last > now() - interval '2 minutes' then
    select * into e from public.etas x where x.user_id = v_uid order by x.created_at desc limit 1;
    return public.olnu_eta_json(e) || jsonb_build_object('ok', false,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '2 minutes' - now())))::int));
  end if;

  update public.etas x set cancelled_at = now()
   where x.user_id = v_uid and x.cancelled_at is null and x.arrived_at is null and x.expires_at > now();

  insert into public.etas (user_id, group_id, bar_id, bar_name, lat, lng, rally_id, minutes, eta_at, expires_at)
  values (v_uid, v_group, v_bar, v_name, v_lat, v_lng, p_rally_id, p_minutes,
          now() + make_interval(mins => p_minutes),
          case when p_rally_id is not null then least(public.olnu_next_expiry(), r.expires_at) else public.olnu_next_expiry() end)
  returning * into e;
  return public.olnu_eta_json(e) || jsonb_build_object('ok', true, 'wait_seconds', 0);
end; $function$;
