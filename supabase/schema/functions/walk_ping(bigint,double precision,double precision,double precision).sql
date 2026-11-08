-- public.walk_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision)
-- live md5(pg_get_functiondef) = 2adfece9152d7b17469ebab4c3e25cd1
CREATE OR REPLACE FUNCTION public.walk_ping(p_id bigint, p_lat double precision, p_lng double precision, p_acc double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid(); w public.walks;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng or abs(p_lat) > 85 or abs(p_lng) > 180 then
    raise exception 'invalid_position';
  end if;
  perform public.olnu_walk_sweep();
  select * into w from public.walks x where x.id = p_id and x.user_id = v_uid;
  if not found then raise exception 'walk_not_found'; end if;
  if w.ended_at is null and (w.pos_at is null or w.pos_at < now() - interval '2 seconds') then
    update public.walks
       set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is not null and p_acc = p_acc then least(9999, greatest(0, round(p_acc)))::int end, pos_at = now()
     where id = w.id returning * into w;
  end if;
  return public.olnu_walk_mine(w) || jsonb_build_object('ok', w.ended_at is null);
end; $function$;
