-- public.ride_ask(p_group_id uuid, p_k text, p_lat double precision, p_lng double precision, p_name text)
-- live md5(pg_get_functiondef) = 3ad575762fb831ff9dd56f6c8e444dd2
CREATE OR REPLACE FUNCTION public.ride_ask(p_group_id uuid, p_k text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); v_drv uuid; v_ok boolean; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_group_id is null or not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  select m.user_id into v_drv from public.group_members m
    join public.driver_status d on d.user_id = m.user_id and d.night = public.olnu_night_of(now())
   where m.group_id = p_group_id and public.olnu_chief_k(p_group_id, m.user_id) = p_k limit 1;
  if v_drv is null or v_drv = v_uid or public.olnu_ub_hidden(v_uid, v_drv) then raise exception 'not_driving'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu-pickup:' || v_uid::text, 0));
  if exists (select 1 from public.pickup_reqs x where x.user_id = v_uid and x.kind = 'skjuts' and x.to_users = array[v_drv]
               and x.created_at > now() - interval '3 minutes')
     or (select count(*) from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '12 hours') >= 12 then
    raise exception 'slow_down';
  end if;
  v_ok := public.olnu_pickup_okpos(p_lat, p_lng);
  perform public.olnu_pickup_sweep();
  update public.pickup_reqs set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.pickup_reqs (user_id, kind, to_users, group_id, lat, lng, pos_at, ends_at)
  values (v_uid, 'skjuts', array[v_drv], case when public.olnu_is_temp_group(p_group_id) then null else p_group_id end,
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok then now() end, now() + interval '60 minutes')
  returning * into r;
  return public.olnu_pickup_mine(r);
end; $function$;
