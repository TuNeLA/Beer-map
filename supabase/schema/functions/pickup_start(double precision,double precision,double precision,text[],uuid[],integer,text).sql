-- public.pickup_start(p_lat double precision, p_lng double precision, p_acc double precision, p_keys text[], p_group_ids uuid[], p_minutes integer, p_name text)
-- live md5(pg_get_functiondef) = 9a219ed75a2cb68540db4665cdc99db2
CREATE OR REPLACE FUNCTION public.pickup_start(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_acc double precision DEFAULT NULL::double precision, p_keys text[] DEFAULT '{}'::text[], p_group_ids uuid[] DEFAULT '{}'::uuid[], p_minutes integer DEFAULT 60, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); v_to uuid[]; v_ok boolean; v_gid uuid; v_min int; r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  perform public.olnu_friend_setname(v_uid, p_name);
  v_ok := public.olnu_pickup_okpos(p_lat, p_lng);
  perform pg_advisory_xact_lock(hashtextextended('olnu-pickup:' || v_uid::text, 0));
  if exists (select 1 from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '60 seconds')
     or (select count(*) from public.pickup_reqs x where x.user_id = v_uid and x.created_at > now() - interval '12 hours') >= 6 then
    raise exception 'slow_down';
  end if;
  v_to := public.olnu_inv_resolve(v_uid, p_keys, p_group_ids);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_to from unnest(v_to) u where u <> v_uid and not public.olnu_ub_hidden(v_uid, u);
  if coalesce(array_length(v_to, 1), 0) = 0 then raise exception 'no_viewers'; end if;
  if array_length(v_to, 1) > 30 then raise exception 'too_many'; end if;
  if coalesce(array_length(p_group_ids, 1), 0) = 1 and not public.olnu_is_temp_group(p_group_ids[1]) then v_gid := p_group_ids[1]; end if;
  v_min := greatest(15, least(120, coalesce(p_minutes, 60)));
  perform public.olnu_pickup_sweep();
  update public.pickup_reqs set ended_at = now(), end_reason = 'replaced', lat = null, lng = null, acc = null
   where user_id = v_uid and ended_at is null;
  insert into public.pickup_reqs (user_id, kind, to_users, group_id, lat, lng, acc, pos_at, ends_at)
  values (v_uid, 'hamta', v_to, v_gid,
          case when v_ok then round(p_lat::numeric, 5)::float8 end, case when v_ok then round(p_lng::numeric, 5)::float8 end,
          case when v_ok and p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end,
          case when v_ok then now() end, now() + make_interval(mins => v_min))
  returning * into r;
  return public.olnu_pickup_mine(r);
end; $function$;
