-- public.olnu_retention_run(p_force boolean)
-- live md5(pg_get_functiondef) = 4bb308308e809a51b216dce533e1e98d
CREATE OR REPLACE FUNCTION public.olnu_retention_run(p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cut timestamptz := now() - interval '30 days';
  v jsonb := '{}'::jsonb;
  n int;
begin
  if not coalesce(p_force, false)
     and coalesce((select f.value from public.app_store_flags f where f.key = 'retention'), 'off') <> 'on' then
    return jsonb_build_object('ok', true, 'skipped', 'retention flag off');
  end if;

  update public.drink_log x set lat = null, lng = null where x.at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('drink_log', n);
  update public.crew_tracks x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('crew_tracks', n);
  update public.checkins x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.created_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('checkins', n);
  update public.game_guesses x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1
   where x.created_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1);
  get diagnostics n = row_count; v := v || jsonb_build_object('game_guesses', n);
  update public.beers x set lat = round(x.lat::numeric / 0.05) * 0.05, lng = round(x.lng::numeric / 0.1) * 0.1,
         prev_lat = null, prev_lng = null, snap_lat = null, snap_lng = null, precise = false
   where x.expires_at < v_cut and (x.lat <> round(x.lat::numeric / 0.05) * 0.05 or x.lng <> round(x.lng::numeric / 0.1) * 0.1
                                   or x.prev_lat is not null or x.snap_lat is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('beers', n);
  update public.bar_reports x set user_lat = null, user_lng = null where x.created_at < v_cut and x.user_lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('bar_reports', n);
  update public.beer_types x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('beer_types', n);
  update public.bar_taps x set lat = null, lng = null where x.last_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('bar_taps', n);
  update public.crew_deps x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('crew_deps', n);
  update public.etas x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('etas', n);
  update public.rallies x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('rallies', n);
  update public.gang_brunches x set lat = null, lng = null where x.created_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('gang_brunches', n);
  update public.find_pos x set lat = null, lng = null where x.updated_at < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('find_pos', n);
  update public.walks x set lat = null, lng = null, home_lat = null, home_lng = null
   where x.started_at < v_cut and (x.lat is not null or x.home_lat is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('walks', n);
  update public.push_subscriptions x set lat = null, lng = null where coalesce(x.loc_at, x.created_at) < v_cut and x.lat is not null;
  get diagnostics n = row_count; v := v || jsonb_build_object('push_subscriptions', n);
  update public.client_vitals x set model = null, browser = null, detail = null where x.created_at < v_cut and (x.model is not null or x.detail is not null);
  get diagnostics n = row_count; v := v || jsonb_build_object('client_vitals', n);

  return jsonb_build_object('ok', true, 'cut', v_cut, 'rows', v);
end; $function$;
