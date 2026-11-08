-- public.olnu_crew_track_add(p_uid uuid, p_kind text, p_bar text, p_name text, p_lat double precision, p_lng double precision)
-- live md5(pg_get_functiondef) = ffbc0a9aca3dd0f4adee5f48e0f689d0
CREATE OR REPLACE FUNCTION public.olnu_crew_track_add(p_uid uuid, p_kind text, p_bar text, p_name text, p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_night timestamptz := public.olnu_night_of(now());
  v_last record;
begin
  if p_lat is null or p_lng is null then return; end if;
  if (select count(*) from public.crew_tracks x where x.user_id = p_uid and x.night = v_night) >= 300 then return; end if;
  select x.lat, x.lng, x.at, x.kind into v_last from public.crew_tracks x
   where x.user_id = p_uid and x.night = v_night order by x.at desc limit 1;
  if v_last.lat is not null and v_last.lat = p_lat and v_last.lng = p_lng and v_last.kind = p_kind
     and v_last.at > now() - interval '5 minutes' then return; end if;
  insert into public.crew_tracks (user_id, night, kind, bar_id, bar_name, lat, lng)
  values (p_uid, v_night, p_kind, p_bar, left(p_name, 60), round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8);
end; $function$;
