-- public.olnu_g_guess(p_uid uuid, p_guess integer, p_town text, p_lat double precision, p_lng double precision, p_now timestamp with time zone)
-- live md5(pg_get_functiondef) = 7dd710f9d7c1a7f725530b30981181e5
CREATE OR REPLACE FUNCTION public.olnu_g_guess(p_uid uuid, p_guess integer, p_town text, p_lat double precision, p_lng double precision, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(p_now);
  v_close timestamptz := (public.olnu_evening(public.olnu_night_of(p_now))::timestamp + interval '21 hours') at time zone 'Europe/Stockholm';
  v_town  text := left(btrim(regexp_replace(regexp_replace(coalesce(p_town, ''), '[\x00-\x1F\x7F]', ' ', 'g'), '\s+', ' ', 'g')), 40);
  v_ch    int;
begin
  if p_now >= v_close then
    raise exception 'too_late';
  end if;
  if p_guess is null or p_guess not between 0 and 20000 then
    raise exception 'invalid_guess';
  end if;
  if p_lat is null or p_lng is null or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between -85.0 and 85.0 or p_lng not between -180.0 and 180.0 then
    raise exception 'outside_sweden';
  end if;
  if v_town = '' then v_town := 'Närområdet'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_game:' || p_uid::text, 0));
  select g.changes into v_ch from public.game_guesses g where g.user_id = p_uid and g.night = v_night;
  if coalesce(v_ch, 0) >= 20 then
    raise exception 'slow_down';
  end if;
  insert into public.game_guesses as g (user_id, night, guess, town, lat, lng, created_at, updated_at)
  values (p_uid, v_night, p_guess, v_town, round(p_lat::numeric, 2)::float8, round(p_lng::numeric, 2)::float8, p_now, p_now)
  on conflict (user_id, night) do update
     set guess = excluded.guess, town = excluded.town, lat = excluded.lat, lng = excluded.lng,
         updated_at = excluded.updated_at, changes = g.changes + 1;
  return jsonb_build_object('ok', true, 'guess', p_guess, 'town', v_town, 'closes_at', v_close);
end;
$function$;
