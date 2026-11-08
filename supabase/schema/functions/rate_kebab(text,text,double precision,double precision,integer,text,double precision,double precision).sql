-- public.rate_kebab(p_place_id text, p_name text, p_lat double precision, p_lng double precision, p_stars integer, p_tag text, p_my_lat double precision, p_my_lng double precision)
-- live md5(pg_get_functiondef) = 5b8321803b3134514756d4cf51219cda
CREATE OR REPLACE FUNCTION public.rate_kebab(p_place_id text, p_name text, p_lat double precision, p_lng double precision, p_stars integer, p_tag text DEFAULT NULL::text, p_my_lat double precision DEFAULT NULL::double precision, p_my_lng double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_pid text := public.olnu_gang_clean(p_place_id);
  v_name text := public.olnu_gang_clean(p_name);
  v_tag text := nullif(lower(public.olnu_gang_clean(p_tag)), '');
  v_night timestamptz := public.olnu_night_of(now());
  v_month date := date_trunc('month', now() at time zone 'Europe/Stockholm')::date;
  bl public.bars_lite;
  v_town text;
  v_new boolean;
  v_avg numeric; v_n int;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'invalid_stars'; end if;
  if v_tag is not null and v_tag not in ('sas', 'storst', 'snabbast', 'krispigast', 'trevligast', 'prisvard', 'starkast', 'raddare') then
    raise exception 'invalid_tag';
  end if;
  if v_pid = '' or char_length(v_pid) > 80 then raise exception 'invalid_place'; end if;
  select * into bl from public.bars_lite b where b.id = v_pid;
  if found then
    if coalesce(bl.type, '') not in ('fast_food', 'restaurant') then raise exception 'not_food'; end if;
    p_lat := bl.lat; p_lng := bl.lng;
    v_name := coalesce(nullif(public.olnu_gang_clean(bl.name), ''), v_name);
  elsif v_pid !~ '^pl_-?[0-9]+_-?[0-9]+$' then
    raise exception 'not_food';
  end if;
  v_name := left(v_name, 60);
  if v_name = '' or not public.olnu_world_ok(p_lat, p_lng) then raise exception 'invalid_place'; end if;
  if not public.olnu_world_ok(p_my_lat, p_my_lng) or public.olnu_dist_m(p_lat, p_lng, p_my_lat, p_my_lng) > 2000 then
    raise exception 'too_far';
  end if;
  perform public.olnu_gang_rl('kebab:' || v_uid::text);
  if exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.updated_at > now() - interval '5 seconds') then
    raise exception 'slow_down';
  end if;
  v_town := public.olnu_gang_town(p_lat, p_lng);
  v_new := not exists (select 1 from public.kebab_ratings k where k.user_id = v_uid and k.place_id = v_pid and k.night = v_night);
  insert into public.kebab_ratings (user_id, place_id, place_name, lat, lng, town, stars, tag, night, month)
  values (v_uid, v_pid, v_name, round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, v_town, p_stars, v_tag, v_night, v_month)
  on conflict (user_id, place_id, night) do update set stars = excluded.stars, tag = excluded.tag, updated_at = now();
  select round(avg(x.stars)::numeric, 2), count(*)::int into v_avg, v_n
    from (select distinct on (k.user_id) k.stars from public.kebab_ratings k
           where k.place_id = v_pid and k.month = v_month order by k.user_id, k.updated_at desc) x;
  return jsonb_build_object('ok', true, 'is_new', v_new, 'avg', v_avg, 'n', v_n,
                            'town', case when left(v_town, 1) = '~' then null else v_town end);
end; $function$;
