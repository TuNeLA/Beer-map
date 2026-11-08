-- public.find_ping(p_key text, p_lat double precision, p_lng double precision, p_acc double precision)
-- live md5(pg_get_functiondef) = 6efaf8cd72ea3ecf7a2845d3278c5504
CREATE OR REPLACE FUNCTION public.find_ping(p_key text, p_lat double precision, p_lng double precision, p_acc double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  t record; r public.find_reqs; fp public.find_pos; me public.find_pos; v_allowed boolean;
begin
  select * into t from public.olnu_find_resolve(p_key, v_uid);
  if not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  r := public.olnu_find_live(v_uid, t.uid);
  v_allowed := public.olnu_find_allowed(v_uid, t.uid);
  if r.id is null and not v_allowed then raise exception 'no_find'; end if;
  select * into me from public.find_pos x where x.user_id = v_uid;
  if me.user_id is null then
    insert into public.find_pos (user_id, lat, lng, acc, target_uid, updated_at, expires_at)
    values (v_uid, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8,
            case when p_acc is null or p_acc = 'NaN'::float8 then null else least(5000, greatest(0, round(p_acc)))::int end,
            t.uid, now(), now() + interval '2 minutes');
  elsif me.updated_at < now() - interval '3 seconds' or me.target_uid is distinct from t.uid or me.lat is null then
    update public.find_pos x
       set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8,
           acc = case when p_acc is null or p_acc = 'NaN'::float8 then null else least(5000, greatest(0, round(p_acc)))::int end,
           target_uid = t.uid, updated_at = now(), expires_at = now() + interval '2 minutes'
     where x.user_id = v_uid;
  end if;
  if v_allowed then
    select * into fp from public.find_pos x where x.user_id = t.uid and x.expires_at > now() and x.lat is not null;
  end if;
  return jsonb_build_object('ok', true, 'name', t.name, 'allowed', v_allowed,
    'status', case when r.id is null then 'share' else r.status end, 'req_id', r.id, 'until', r.until,
    'answer_by', r.answer_by,
    'target', case when fp.user_id is not null then jsonb_build_object('lat', fp.lat, 'lng', fp.lng, 'acc', fp.acc,
                'age_s', greatest(0, extract(epoch from now() - fp.updated_at))::int) end,
    'finding_me', fp.user_id is not null and fp.target_uid = v_uid);
end; $function$;
