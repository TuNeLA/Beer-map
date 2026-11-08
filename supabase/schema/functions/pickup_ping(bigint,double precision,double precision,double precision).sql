-- public.pickup_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision)
-- live md5(pg_get_functiondef) = 5e1004e2233435b3e2fd28203fba45a1
CREATE OR REPLACE FUNCTION public.pickup_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := public.olnu_uid(); r public.pickup_reqs;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.olnu_pickup_okpos(p_lat, p_lng) then raise exception 'invalid_position'; end if;
  perform public.olnu_pickup_sweep();
  select * into r from public.pickup_reqs x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'not_found'; end if;
  if r.ended_at is null and (r.pos_at is null or r.pos_at < now() - interval '5 seconds') then
    update public.pickup_reqs set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end, pos_at = now()
     where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'live', r.ended_at is null);
end; $function$;
