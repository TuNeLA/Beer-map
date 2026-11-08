-- public.crew_dance_report(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_level integer)
-- live md5(pg_get_functiondef) = 3d55e651acb55d3e25ff0b6acfed6701
CREATE OR REPLACE FUNCTION public.crew_dance_report(p_bar_id text, p_bar_name text, p_bar_lat double precision, p_bar_lng double precision, p_lat double precision, p_lng double precision, p_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := public.olnu_uid();
  v_bar text := public.olnu_crew_clean(p_bar_id, 200);
  v_blat float8 := p_bar_lat; v_blng float8 := p_bar_lng;
  v_last timestamptz; s jsonb;
begin
  if p_level is null or p_level not in (0, 1, 2) then raise exception 'invalid_level'; end if;
  if v_bar is null or char_length(v_bar) > 80 then raise exception 'invalid_bar'; end if;
  select bl.lat, bl.lng into v_blat, v_blng from public.bars_lite bl where bl.id = v_bar;
  if v_blat is null then v_blat := p_bar_lat; v_blng := p_bar_lng; end if;
  if not public.olnu_world_ok(v_blat, v_blng) or not public.olnu_world_ok(p_lat, p_lng) then raise exception 'outside_sweden'; end if;
  if public.olnu_dist_m(v_blat, v_blng, p_lat, p_lng) > 300 then raise exception 'too_far'; end if;
  perform pg_advisory_xact_lock(hashtextextended('olnu_crew_dance:' || v_uid::text, 0));
  select max(d.created_at) into v_last from public.crew_dance d where d.user_id = v_uid and d.bar_id = v_bar;
  if v_last is not null and v_last > now() - interval '10 minutes' then
    s := public.olnu_crew_dance_json(v_bar);
    return s || jsonb_build_object('ok', false,
      'wait_seconds', greatest(1, ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::int));
  end if;
  insert into public.crew_dance (bar_id, user_id, level, bar_lat, bar_lng, expires_at)
  values (v_bar, v_uid, p_level, round(v_blat::numeric, 5)::float8, round(v_blng::numeric, 5)::float8, now() + interval '30 minutes');
  return public.olnu_crew_dance_json(v_bar) || jsonb_build_object('ok', true, 'wait_seconds', 0);
end; $function$;
