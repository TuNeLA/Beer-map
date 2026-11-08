-- public.walk_start(p_home_lat double precision, p_home_lng double precision, p_keys text[], p_group_ids uuid[], p_group_id uuid, p_lat double precision, p_lng double precision, p_acc double precision, p_name text)
-- live md5(pg_get_functiondef) = 50da428d7aaffa4a3c084bd85fe5bd7e
CREATE OR REPLACE FUNCTION public.walk_start(p_home_lat double precision, p_home_lng double precision, p_keys text[] DEFAULT '{}'::text[], p_group_ids uuid[] DEFAULT '{}'::uuid[], p_group_id uuid DEFAULT NULL::uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_acc double precision DEFAULT NULL::double precision, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_to uuid[]; v_gid uuid := p_group_id; v_id bigint; w public.walks; v_ok boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  if p_home_lat is null or p_home_lng is null or p_home_lat <> p_home_lat or p_home_lng <> p_home_lng
     or abs(p_home_lat) > 85 or abs(p_home_lng) > 180 then
    raise exception 'invalid_home';
  end if;
  v_ok := p_lat is not null and p_lng is not null and p_lat = p_lat and p_lng = p_lng and abs(p_lat) <= 85 and abs(p_lng) <= 180;
  perform pg_advisory_xact_lock(hashtextextended('olnu-walk:' || v_uid::text, 0));
  if exists (select 1 from public.walks x where x.user_id = v_uid and x.started_at > now() - interval '10 seconds')
     or (select count(*) from public.walks x where x.user_id = v_uid and x.started_at > now() - interval '12 hours') >= 8 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_viewers'; end if;
  if array_length(v_to, 1) > 30 then raise exception 'too_many'; end if;
  if v_gid is null and coalesce(array_length(p_group_ids, 1), 0) = 1 then v_gid := p_group_ids[1]; end if;
  if v_gid is not null and (public.olnu_is_temp_group(v_gid)
       or not exists (select 1 from public.group_members m where m.group_id = v_gid and m.user_id = v_uid)) then
    v_gid := null;
  end if;
  perform public.olnu_walk_sweep();
  update public.walks set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.walks (user_id, group_id, viewers, home_lat, home_lng, ends_at, lat, lng, acc, pos_at, start_dist)
  values (v_uid, v_gid, v_to, round(p_home_lat::numeric, 3)::float8, round(p_home_lng::numeric, 3)::float8,
          now() + interval '2 hours',
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok and p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end,
          case when v_ok then now() end,
          case when v_ok then least(2000000, round(public.olnu_bp_m(p_lat, p_lng, p_home_lat, p_home_lng)))::int end)
  returning * into w;
  return public.olnu_walk_mine(w);
end; $function$;
