-- public.record_bar(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = f855035c8c0c0c7914b48ae619901a31
CREATE OR REPLACE FUNCTION public.record_bar(p_bar_id text, p_bar_name text, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := public.olnu_uid();
  v_id   text := btrim(coalesce(p_bar_id, ''));
  v_name text := left(btrim(regexp_replace(coalesce(p_bar_name, ''), '[[:cntrl:]]', ' ', 'g')), 80);
  v_ok   boolean;
begin
  if char_length(v_id) < 1 or char_length(v_id) > 64
     or p_lat is null or p_lng is null
     or p_lat in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lng in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8)
     or p_lat < -85.0 or p_lat > 85.0 or p_lng < -180.0 or p_lng > 180.0 then
    return;
  end if;

  select exists (
    select 1 from public.beers b
     where b.user_id = v_uid
       and b.expires_at > now()
       and not b.stopped
       and b.precise
       and b.beer_count > 0
       and coalesce(b.beer_at, b.updated_at) > now() - interval '3 minutes'
       and public.olnu_dist_m(b.lat, b.lng, p_lat, p_lng) <= 150
  ) into v_ok;
  if not v_ok then
    return;
  end if;

  insert into public.bar_taps (user_id, bar_id, week, n, bar_name, lat, lng, last_at)
  values (v_uid, v_id, public.olnu_week_start(now()), 1, nullif(v_name, ''),
          round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, now())
  on conflict (user_id, bar_id, week) do update
     set n = public.bar_taps.n + 1,
         last_at = now(),
         bar_name = coalesce(excluded.bar_name, public.bar_taps.bar_name),
         lat = excluded.lat,
         lng = excluded.lng
   where public.bar_taps.last_at <= now() - interval '9 minutes';
end;
$function$;
