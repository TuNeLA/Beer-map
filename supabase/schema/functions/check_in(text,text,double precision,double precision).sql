-- public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = a477f25068ff9b370d4d33a05fea8a84
CREATE OR REPLACE FUNCTION public.check_in(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(regexp_replace(coalesce(p_bar_id, ''), '[\x00-\x1F\x7F]', ' ', 'g'));
  v_name text := btrim(regexp_replace(regexp_replace(coalesce(p_bar_name, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g'));
  v_row  public.checkins%rowtype;
  v_cool constant interval := interval '2 minutes';
begin
  if p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    raise exception 'outside_sweden';
  end if;
  if char_length(v_id) < 1 or char_length(v_id) > 80 or char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'invalid_bar';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('olnu_checkin:' || v_uid::text, 0));
  select * into v_row from public.checkins c where c.user_id = v_uid;
  if found and v_row.created_at > now() - v_cool then
    return jsonb_build_object('ok', false,
      'bar_name', case when v_row.expires_at > now() then v_row.bar_name else null end,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_row.created_at + v_cool - now())))::int));
  end if;

  insert into public.checkins (user_id, bar_id, bar_name, lat, lng, created_at, expires_at)
  values (v_uid, v_id, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8,
          now(), public.olnu_next_expiry())
  on conflict (user_id) do update
     set bar_id = excluded.bar_id, bar_name = excluded.bar_name, lat = excluded.lat, lng = excluded.lng,
         created_at = excluded.created_at, expires_at = excluded.expires_at;

  return jsonb_build_object('ok', true, 'bar_name', v_name, 'wait_seconds', 0);
end;
$function$;
